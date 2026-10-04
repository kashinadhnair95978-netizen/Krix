import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';
import { detectCountry, getPaymentProvider } from '@/lib/geoip';
import { paymentError } from '@/lib/payment-security';
import {
  PLANS,
  isPaymentProvider,
  isPlanKey,
  providerReadiness,
  razorpayPlanId,
  stripePriceId,
  type PaymentProvider,
  type PaidPlanKey,
} from '@/lib/plans';
import { getStripe } from '@/lib/stripe';
import { createRazorpayCustomer, createRazorpaySubscription } from '@/lib/razorpay';

export const runtime = 'nodejs';

function appUrl(req: NextRequest): string {
  return (
    process.env.KRIX_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    req.nextUrl.origin
  ).replace(/\/$/, '');
}

async function resolveProvider(req: NextRequest, requested: unknown): Promise<PaymentProvider> {
  if (isPaymentProvider(requested)) return requested;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    '';
  // Local development has no routable IP; Stripe is the safe default there
  // because the account's country is not known and the caller may pass one
  // explicitly.
  const isLocal = !ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.');
  const country = isLocal ? 'US' : await detectCountry(ip);
  return getPaymentProvider(country);
}

/**
 * POST /api/payments/create
 *
 * The one authenticated endpoint that creates a real checkout. It returns a
 * provider checkout handle and nothing else — no key, no secret, and no claim
 * that a payment happened.
 *
 * A subscription only becomes `active` after a provider-verified event: the
 * Stripe webhook (signature checked against STRIPE_WEBHOOK_SECRET), the Razorpay
 * webhook, or /api/payments/razorpay/confirm, which re-reads the payment from
 * Razorpay's API before it activates anything. No client-supplied field can
 * activate a plan.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      const err = paymentError(401, 'UNAUTHORIZED', 'Sign in to start a checkout.');
      return NextResponse.json(err.body, { status: err.status });
    }

    let body: { plan?: unknown; provider?: unknown };
    try {
      body = await req.json();
    } catch {
      const err = paymentError(400, 'INVALID_REQUEST', 'Request body must be JSON.');
      return NextResponse.json(err.body, { status: err.status });
    }

    if (!isPlanKey(body.plan)) {
      const err = paymentError(400, 'INVALID_PLAN', 'Choose a paid plan before checking out.', {
        plans: Object.keys(PLANS),
      });
      return NextResponse.json(err.body, { status: err.status });
    }
    const plan: PaidPlanKey = body.plan;

    if (body.provider !== undefined && !isPaymentProvider(body.provider)) {
      const err = paymentError(
        400,
        'INVALID_PROVIDER',
        'Payment provider must be "stripe" or "razorpay".'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    const provider = await resolveProvider(req, body.provider);
    const readiness = providerReadiness(provider);
    if (!readiness.ready) {
      const err = paymentError(
        503,
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        readiness.reason as string,
        { provider, missing: readiness.missing }
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    const supabase = supabaseServer();
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      console.error('payments/create: user lookup failed', userError.message);
      const err = paymentError(500, 'PROFILE_LOOKUP_FAILED', 'Could not read your account profile.');
      return NextResponse.json(err.body, { status: err.status });
    }
    if (!user) {
      const err = paymentError(
        404,
        'PROFILE_NOT_FOUND',
        'Your account profile is missing. Sign out and sign in again.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    if (provider === 'stripe') {
      const priceId = stripePriceId(plan);
      if (!priceId) {
        const err = paymentError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Stripe is not configured.');
        return NextResponse.json(err.body, { status: err.status });
      }

      const stripe = getStripe();
      // Reuse the customer we already created for this account, otherwise every
      // checkout attempt would orphan a customer record.
      const existing = await stripe.customers.list({ email: user.email, limit: 1 });
      const customerId =
        existing.data[0]?.id ??
        (await stripe.customers.create({ email: user.email, metadata: { userId } })).id;

      const base = appUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: userId,
        metadata: { userId, plan },
        subscription_data: { metadata: { userId, plan } },
        success_url: `${base}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/pricing?checkout=cancelled&plan=${plan}`,
        allow_promotion_codes: false,
      });

      return NextResponse.json({
        provider: 'stripe',
        plan,
        checkoutUrl: session.url,
        sessionId: session.id,
      });
    }

    const planId = razorpayPlanId(plan);
    if (!planId) {
      const err = paymentError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Razorpay is not configured.');
      return NextResponse.json(err.body, { status: err.status });
    }

    const customer = await createRazorpayCustomer(user.email, user.full_name || 'Krix user');
    const subscription = await createRazorpaySubscription(planId, customer.id);

    // Record the intent. It stays `pending` until Razorpay's webhook (or a
    // confirmed capture through /api/payments/razorpay/confirm) activates it.
    const { error: insertError } = await supabase.from('subscriptions').upsert(
      {
        user_id: userId,
        plan,
        status: 'pending',
        payment_method: 'razorpay',
        recurring_id: subscription.id,
        monthly_price: PLANS[plan].amountInr / 100,
        currency: 'inr',
      },
      { onConflict: 'user_id,recurring_id' }
    );
    if (insertError) {
      console.error('payments/create: could not record subscription intent', insertError.message);
      const err = paymentError(
        500,
        'CHECKOUT_INIT_FAILED',
        'The subscription could not be recorded. Nothing was charged — please try again.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    return NextResponse.json({
      provider: 'razorpay',
      plan,
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('payments/create failed:', message);
    const configured = message.includes('not set') || message.includes('placeholder');
    const err = configured
      ? paymentError(
          503,
          'PAYMENT_PROVIDER_NOT_CONFIGURED',
          'This payment method is not configured on the server yet.'
        )
      : paymentError(
          500,
          'CHECKOUT_INIT_FAILED',
          'The checkout could not be started. No payment was taken — please try again.'
        );
    return NextResponse.json(err.body, { status: err.status });
  }
}
