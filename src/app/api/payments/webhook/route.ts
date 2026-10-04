import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseServer } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { hmacSha256Hex, safeEqual } from '@/lib/payment-security';
import {
  PLANS,
  isPlanKey,
  razorpayKeySecret,
  stripeWebhookSecret,
} from '@/lib/plans';

export const runtime = 'nodejs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a plan we actually sell may be written to `subscriptions`. */
function planFromMetadata(metadata: Stripe.Metadata | null | undefined) {
  const plan = metadata?.plan;
  return isPlanKey(plan) ? plan : null;
}

function userIdFromMetadata(metadata: Stripe.Metadata | null | undefined) {
  const userId = metadata?.userId;
  return typeof userId === 'string' && UUID_RE.test(userId) ? userId : null;
}

async function recordPayment(args: {
  userId: string;
  subscriptionId: string | null;
  externalPaymentId: string;
  amount: number;
  currency: string;
  method: 'stripe' | 'razorpay';
  invoiceUrl?: string | null;
}) {
  const supabase = supabaseServer();
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('external_payment_id', args.externalPaymentId)
    .maybeSingle();
  if (existing) return; // provider retry — never double-count revenue

  let rowSubscriptionId: string | null = null;
  if (args.subscriptionId) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', args.userId)
      .eq('recurring_id', args.subscriptionId)
      .maybeSingle();
    rowSubscriptionId = sub?.id ?? null;
  }

  await supabase.from('payments').insert({
    user_id: args.userId,
    subscription_id: rowSubscriptionId,
    amount: args.amount / 100,
    currency: args.currency,
    payment_method: args.method,
    external_payment_id: args.externalPaymentId,
    status: 'success',
    invoice_url: args.invoiceUrl ?? null,
  });
}

async function upsertStripeSubscription(args: {
  userId: string;
  plan: string;
  recurringId: string;
  status: string;
  paymentId?: string | null;
  currency?: string | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
}) {
  const supabase = supabaseServer();
  const patch: Record<string, unknown> = { status: args.status };
  if (args.paymentId) patch.payment_id = args.paymentId;
  if (args.currentPeriodStart) {
    patch.current_period_start = new Date(args.currentPeriodStart * 1000).toISOString();
  }
  if (args.currentPeriodEnd) {
    patch.current_period_end = new Date(args.currentPeriodEnd * 1000).toISOString();
  }
  if (args.cancelAtPeriodEnd !== undefined) {
    patch.cancel_at_period_end = args.cancelAtPeriodEnd;
  }

  // Update first: the row normally exists (/api/payments/create recorded it).
  const { data: updated } = await supabase
    .from('subscriptions')
    .update(patch)
    .eq('user_id', args.userId)
    .eq('recurring_id', args.recurringId)
    .select('id')
    .maybeSingle();
  if (updated) return;

  // Stripe can deliver `customer.subscription.created` before
  // `checkout.session.completed`. The metadata below was set by this server on
  // the checkout, and the event signature is already verified, so the row can
  // be created here rather than leaving the account without a subscription.
  await supabase.from('subscriptions').upsert(
    {
      user_id: args.userId,
      plan: args.plan,
      status: args.status,
      payment_method: 'stripe',
      recurring_id: args.recurringId,
      payment_id: args.paymentId ?? null,
      monthly_price: PLANS[args.plan as keyof typeof PLANS].amountUsd / 100,
      currency: args.currency ?? 'usd',
      cancel_at_period_end: args.cancelAtPeriodEnd ?? false,
      ...(args.currentPeriodStart
        ? { current_period_start: new Date(args.currentPeriodStart * 1000).toISOString() }
        : {}),
      ...(args.currentPeriodEnd
        ? { current_period_end: new Date(args.currentPeriodEnd * 1000).toISOString() }
        : {}),
    },
    { onConflict: 'user_id,recurring_id' }
  );
}

async function handleStripeEvent(event: Stripe.Event) {
  const supabase = supabaseServer();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId =
        (typeof session.client_reference_id === 'string' &&
          UUID_RE.test(session.client_reference_id)
          ? session.client_reference_id
          : null) ?? userIdFromMetadata(session.metadata);
      const plan = planFromMetadata(session.metadata);
      const recurringId =
        typeof session.subscription === 'string'
          ? session.subscription
          : (session.subscription?.id ?? null);

      if (!userId || !plan || !recurringId) {
        console.error('stripe webhook: checkout.session.completed without usable ownership data', {
          hasUserId: Boolean(userId),
          hasPlan: Boolean(plan),
          hasSubscription: Boolean(recurringId),
        });
        break;
      }

      await upsertStripeSubscription({
        userId,
        plan,
        recurringId,
        status: session.payment_status === 'paid' ? 'active' : 'pending',
        paymentId:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
      });
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId =
        userIdFromMetadata(subscription.metadata) ??
        (await (async () => {
          const { data } = await supabase
            .from('subscriptions')
            .select('user_id')
            .eq('recurring_id', subscription.id)
            .maybeSingle();
          return data?.user_id ?? null;
        })());
      const plan =
        planFromMetadata(subscription.metadata) ??
        (await (async () => {
          const { data } = await supabase
            .from('subscriptions')
            .select('plan')
            .eq('user_id', userId as string)
            .eq('recurring_id', subscription.id)
            .maybeSingle();
          return data?.plan ?? null;
        })());
      if (!userId || !plan || !isPlanKey(plan)) break;

      await upsertStripeSubscription({
        userId,
        plan,
        recurringId: subscription.id,
        status: subscription.status === 'active' ? 'active' : 'canceled',
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await supabase
        .from('subscriptions')
        .update({ status: 'canceled', cancel_at_period_end: false })
        .eq('recurring_id', subscription.id);
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const recurringId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : (invoice.subscription?.id ?? null);
      if (!recurringId) break;
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('recurring_id', recurringId)
        .maybeSingle();
      if (!sub?.user_id) break;
      await recordPayment({
        userId: sub.user_id,
        subscriptionId: recurringId,
        externalPaymentId: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        method: 'stripe',
        invoiceUrl: invoice.hosted_invoice_url,
      });
      break;
    }

    default:
      break;
  }
}

async function handleRazorpayEvent(payload: Record<string, unknown>) {
  const supabase = supabaseServer();
  const event = payload.event;
  const paymentPayload = payload.payload as
    | { payment?: { entity?: Record<string, any> } }
    | undefined;
  const subscriptionPayload = payload.payload as
    | { subscription?: { entity?: Record<string, any> } }
    | undefined;

  if (event === 'subscription.activated' || event === 'subscription.cancelled') {
    const entity = subscriptionPayload?.subscription?.entity;
    const recurringId = typeof entity?.id === 'string' ? entity.id : null;
    if (!recurringId) return;
    await supabase
      .from('subscriptions')
      .update({ status: event === 'subscription.activated' ? 'active' : 'canceled' })
      .eq('recurring_id', recurringId);
    return;
  }

  if (event === 'payment.captured') {
    const entity = paymentPayload?.payment?.entity;
    const paymentId = typeof entity?.id === 'string' ? entity.id : null;
    const recurringId =
      typeof entity?.subscription_id === 'string' ? entity.subscription_id : null;
    if (!paymentId) return;

    if (recurringId) {
      await supabase
        .from('subscriptions')
        .update({ status: 'active', payment_id: paymentId })
        .eq('recurring_id', recurringId);
    }

    const { data: sub } = recurringId
      ? await supabase
          .from('subscriptions')
          .select('user_id')
          .eq('recurring_id', recurringId)
          .maybeSingle()
      : { data: null };
    if (!sub?.user_id) {
      console.error('razorpay webhook: captured payment has no matching subscription', {
        paymentId,
        recurringId,
      });
      return;
    }

    await recordPayment({
      userId: sub.user_id,
      subscriptionId: recurringId,
      externalPaymentId: paymentId,
      amount: Number(entity?.amount ?? 0),
      currency: String(entity?.currency ?? 'INR').toLowerCase(),
      method: 'razorpay',
    });
  }
}

/**
 * POST /api/payments/webhook
 *
 * The only unauthenticated route in the product, and the only place besides
 * Razorpay's confirmed capture that may write a subscription to `active`.
 * Every branch below runs only after a provider signature check against a
 * secret that is present and non-placeholder; a missing secret is a 503, never
 * a silent accept.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const stripeSignature = req.headers.get('stripe-signature');
  const razorpaySignature = req.headers.get('x-razorpay-signature');

  if (!stripeSignature && !razorpaySignature) {
    return NextResponse.json(
      { error: 'MISSING_SIGNATURE', message: 'No provider signature was supplied.' },
      { status: 400 }
    );
  }

  if (stripeSignature) {
    const secret = stripeWebhookSecret();
    if (!secret) {
      return NextResponse.json(
        {
          error: 'WEBHOOK_NOT_CONFIGURED',
          message:
            'STRIPE_WEBHOOK_SECRET is not set on this server, so Stripe webhooks cannot be verified.',
        },
        { status: 503 }
      );
    }
    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(body, stripeSignature, secret);
    } catch {
      return NextResponse.json(
        { error: 'INVALID_SIGNATURE', message: 'The Stripe webhook signature is invalid.' },
        { status: 400 }
      );
    }
    try {
      await handleStripeEvent(event);
    } catch (error) {
      // A 500 makes the provider retry, which is the correct outcome for a
      // transient database failure. Never leak the internal error.
      console.error(
        'stripe webhook handler failed:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return NextResponse.json(
        { error: 'WEBHOOK_HANDLER_FAILED', message: 'The webhook could not be processed.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ received: true, provider: 'stripe' });
  }

  const keySecret = razorpayKeySecret();
  if (!keySecret) {
    return NextResponse.json(
      {
        error: 'WEBHOOK_NOT_CONFIGURED',
        message:
          'RAZORPAY_KEY_SECRET is not set on this server, so Razorpay webhooks cannot be verified.',
      },
      { status: 503 }
    );
  }
  if (!safeEqual(hmacSha256Hex(keySecret, body), razorpaySignature as string)) {
    return NextResponse.json(
      { error: 'INVALID_SIGNATURE', message: 'The Razorpay webhook signature is invalid.' },
      { status: 400 }
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'INVALID_REQUEST', message: 'Webhook body must be JSON.' },
      { status: 400 }
    );
  }

  try {
    await handleRazorpayEvent(payload);
  } catch (error) {
    console.error(
      'razorpay webhook handler failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return NextResponse.json(
      { error: 'WEBHOOK_HANDLER_FAILED', message: 'The webhook could not be processed.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ received: true, provider: 'razorpay' });
}
