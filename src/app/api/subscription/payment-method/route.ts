import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';
import { paymentError, safeEqual } from '@/lib/payment-security';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

type StripeClient = Stripe;

/**
 * PUT|PATCH /api/subscription/payment-method
 *
 * The previous version trusted the caller for two things that mattered: which
 * Stripe customer the payment method belonged to, and the card details that were
 * stored. Both are now provider-derived:
 *
 *   - the Stripe customer is resolved from THIS user's account email and then
 *     proven by asking Stripe whether it actually holds the subscription id we
 *     have on file. A `pm_` id belonging to any other customer is rejected, so
 *     no account can mutate another account's default payment method;
 *   - brand, last4 and expiry are read from the Stripe object and the request
 *     body contributes nothing but the payment-method id.
 *
 * There is deliberately no insert into `payment_methods`: that table does not
 * exist in the deployed schema. Stripe stays the source of truth and
 * `subscriptions.payment_id` is the only local pointer, so no provider token is
 * duplicated into a second store that could drift.
 */
async function updatePaymentMethod(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      const err = paymentError(401, 'UNAUTHORIZED', 'Sign in to manage your payment method.');
      return NextResponse.json(err.body, { status: err.status });
    }

    let body: { paymentMethodId?: unknown };
    try {
      body = (await req.json()) as { paymentMethodId?: unknown };
    } catch {
      const err = paymentError(400, 'INVALID_REQUEST', 'Request body must be JSON.');
      return NextResponse.json(err.body, { status: err.status });
    }

    const paymentMethodId =
      typeof body.paymentMethodId === 'string' ? body.paymentMethodId.trim() : '';
    if (!/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)) {
      const err = paymentError(
        400,
        'INVALID_PAYMENT_METHOD',
        'A Stripe payment method id is required.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    const supabase = supabaseServer();
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('payment_method', 'stripe')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subscription) {
      const err = paymentError(
        404,
        'NO_SUBSCRIPTION',
        'No Stripe subscription was found for this account.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();
    if (!user?.email) {
      const err = paymentError(404, 'PROFILE_NOT_FOUND', 'Your account profile could not be read.');
      return NextResponse.json(err.body, { status: err.status });
    }

    const stripe = getStripe();
    const customerId = await resolveOwningCustomer(
      stripe,
      user.email,
      subscription.recurring_id
    );
    if (!customerId) {
      const err = paymentError(
        404,
        'STRIPE_SUBSCRIPTION_NOT_FOUND',
        'Stripe does not hold this subscription for your account, so its payment method cannot be changed here.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    let paymentMethod;
    try {
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    } catch {
      const err = paymentError(
        404,
        'PAYMENT_METHOD_NOT_FOUND',
        'Stripe does not know that payment method.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    const owner =
      typeof paymentMethod.customer === 'string' ? paymentMethod.customer : null;
    if (!safeEqual(owner, customerId)) {
      const err = paymentError(
        403,
        'PAYMENT_METHOD_FORBIDDEN',
        'That payment method does not belong to your account.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    if (paymentMethod.customer !== customerId) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    }
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Everything returned below comes from the Stripe object.
    const card = paymentMethod.card;
    return NextResponse.json({
      message: 'Payment method updated',
      paymentMethod: {
        id: paymentMethod.id,
        brand: card?.brand ?? null,
        last4: card?.last4 ?? null,
        expMonth: card?.exp_month ?? null,
        expYear: card?.exp_year ?? null,
      },
    });
  } catch (error) {
    console.error(
      'update payment method error:',
      error instanceof Error ? error.message : 'unknown error'
    );
    const err = paymentError(
      500,
      'PAYMENT_METHOD_UPDATE_FAILED',
      'The payment method could not be updated. No charge was made.'
    );
    return NextResponse.json(err.body, { status: err.status });
  }
}

/**
 * Which of this user's Stripe customers actually holds our subscription id.
 * Answered by Stripe, not by anything the client sent.
 */
async function resolveOwningCustomer(
  stripe: StripeClient,
  email: string,
  recurringId: string | null
): Promise<string | null> {
  if (!recurringId) return null;
  const customers = await stripe.customers.list({ email, limit: 10 });
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 100,
    });
    if (subs.data.some((s) => s.id === recurringId)) return customer.id;
  }
  return null;
}

export async function PUT(req: NextRequest) {
  return updatePaymentMethod(req);
}

export async function PATCH(req: NextRequest) {
  return updatePaymentMethod(req);
}
