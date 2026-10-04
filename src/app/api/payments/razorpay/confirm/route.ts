import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';
import { paymentError, verifyRazorpaySignature } from '@/lib/payment-security';
import { razorpayKeySecret } from '@/lib/plans';
import { fetchRazorpayPayment } from '@/lib/razorpay';

export const runtime = 'nodejs';

interface ConfirmBody {
  subscriptionId?: unknown;
  razorpay_order_id?: unknown;
  razorpay_payment_id?: unknown;
  razorpay_signature?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * POST /api/payments/razorpay/confirm
 *
 * The browser may only nominate *which* payment to check. Three server-side
 * facts decide the outcome:
 *   1. the pending subscription belongs to the calling user,
 *   2. the Razorpay HMAC over `order_id|payment_id` matches, and
 *   3. Razorpay's own API reports the payment as captured against that
 *      subscription.
 * A client that lies about any of the three gets nothing, and the subscription
 * row is not touched.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      const err = paymentError(401, 'UNAUTHORIZED', 'Sign in to complete your payment.');
      return NextResponse.json(err.body, { status: err.status });
    }

    const keySecret = razorpayKeySecret();
    if (!keySecret) {
      const err = paymentError(
        503,
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        'Razorpay is not configured on this server, so payments cannot be verified.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    let body: ConfirmBody;
    try {
      body = (await req.json()) as ConfirmBody;
    } catch {
      const err = paymentError(400, 'INVALID_REQUEST', 'Request body must be JSON.');
      return NextResponse.json(err.body, { status: err.status });
    }

    const subscriptionId = asString(body.subscriptionId);
    const orderId = asString(body.razorpay_order_id);
    const paymentId = asString(body.razorpay_payment_id);
    const signature = asString(body.razorpay_signature);

    if (!subscriptionId || !orderId || !paymentId || !signature) {
      const err = paymentError(
        400,
        'INVALID_REQUEST',
        'subscriptionId, razorpay_order_id, razorpay_payment_id and razorpay_signature are all required.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    const supabase = supabaseServer();

    // Ownership first: a subscription id that is not this user's is
    // indistinguishable from one that does not exist.
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('recurring_id', subscriptionId)
      .maybeSingle();

    if (!subscription) {
      const err = paymentError(404, 'SUBSCRIPTION_NOT_FOUND', 'No pending checkout was found for this account.');
      return NextResponse.json(err.body, { status: err.status });
    }

    if (!verifyRazorpaySignature({ orderId, paymentId, signature, keySecret })) {
      const err = paymentError(
        400,
        'INVALID_PAYMENT_SIGNATURE',
        'The payment signature did not match. Your plan was not upgraded.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    // The signature only proves the browser held a key Razorpay gave it for
    // this payment. Razorpay's API decides whether the money actually moved.
    const payment = await fetchRazorpayPayment(paymentId);
    const captured = payment.captured === true || payment.status === 'captured';
    if (!captured) {
      const err = paymentError(
        402,
        'PAYMENT_NOT_CAPTURED',
        'Razorpay has not confirmed this payment yet. Your plan was not upgraded — retry from the pricing page.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }
    if (payment.subscription_id && payment.subscription_id !== subscriptionId) {
      const err = paymentError(
        400,
        'PAYMENT_SUBSCRIPTION_MISMATCH',
        'That payment belongs to a different subscription.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    const { data: updated, error: updateError } = await supabase
      .from('subscriptions')
      .update({ status: 'active', payment_id: paymentId })
      .eq('id', subscription.id)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('razorpay confirm: activation failed', updateError?.message);
      const err = paymentError(
        500,
        'ACTIVATION_FAILED',
        'The payment was verified but the plan could not be activated. Contact support with your payment id.'
      );
      return NextResponse.json(err.body, { status: err.status });
    }

    // Idempotent ledger write: Razorpay retries webhooks, and a duplicate row
    // for the same external id would corrupt revenue reporting.
    const { data: alreadyRecorded } = await supabase
      .from('payments')
      .select('id')
      .eq('external_payment_id', paymentId)
      .maybeSingle();
    if (!alreadyRecorded) {
      await supabase.from('payments').insert({
        user_id: userId,
        subscription_id: updated.id,
        amount: (payment.amount || 0) / 100,
        currency: payment.currency || 'inr',
        payment_method: 'razorpay',
        external_payment_id: paymentId,
        status: 'success',
      });
    }

    return NextResponse.json({
      verified: true,
      subscription: {
        plan: updated.plan,
        status: updated.status,
        paymentMethod: updated.payment_method,
      },
    });
  } catch (error) {
    console.error(
      'razorpay confirm failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    const err = paymentError(
      500,
      'VERIFICATION_FAILED',
      'The payment could not be verified. Your plan was not upgraded — retry from the pricing page.'
    );
    return NextResponse.json(err.body, { status: err.status });
  }
}
