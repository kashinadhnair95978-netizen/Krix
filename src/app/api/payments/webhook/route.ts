import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { stripe } from '@/lib/stripe';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const supabase = supabaseServer();

    // Handle Stripe webhook
    const sig = req.headers.get('stripe-signature');
    if (sig) {
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET!
        );
      } catch (err) {
        return NextResponse.json(
          { message: 'Invalid Stripe signature' },
          { status: 400 }
        );
      }

      switch (event.type) {
        case 'customer.subscription.updated':
        case 'customer.subscription.created': {
          const subscription = event.data.object as any;
          await supabase
            .from('subscriptions')
            .update({
              status: subscription.status === 'active' ? 'active' : 'canceled',
              cancel_at_period_end:
                subscription.cancel_at_period_end || false,
              current_period_start: new Date(
                subscription.current_period_start * 1000
              ).toISOString(),
              current_period_end: new Date(
                subscription.current_period_end * 1000
              ).toISOString(),
            })
            .eq('recurring_id', subscription.id);
          break;
        }
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          await supabase
            .from('subscriptions')
            .update({ status: 'canceled' })
            .eq('recurring_id', subscription.id);
          break;
        }
        case 'invoice.paid': {
          const invoice = event.data.object as any;
          const { data: sub } = await supabase
            .from('subscriptions')
            .select('user_id, id')
            .eq('recurring_id', invoice.subscription)
            .single();

          await supabase.from('payments').insert({
            user_id: sub?.user_id ?? null,
            subscription_id: sub?.id ?? null,
            amount: invoice.amount_paid / 100,
            currency: invoice.currency,
            payment_method: 'stripe',
            external_payment_id: invoice.id,
            status: 'success',
            invoice_url: invoice.hosted_invoice_url,
          });
          break;
        }
        default:
          break;
      }
    }

    // Handle Razorpay webhook
    const razorpaySignature = req.headers.get('x-razorpay-signature');
    if (razorpaySignature) {
      const hash = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
        .update(body)
        .digest('hex');

      if (hash !== razorpaySignature) {
        return NextResponse.json(
          { message: 'Invalid signature' },
          { status: 400 }
        );
      }

      const data = JSON.parse(body);

      if (data.event === 'subscription.activated') {
        const entity = data.payload.subscription.entity;
        await supabase
          .from('subscriptions')
          .update({ status: 'active' })
          .eq('recurring_id', entity.id);
      }

      if (data.event === 'subscription.cancelled') {
        const entity = data.payload.subscription.entity;
        await supabase
          .from('subscriptions')
          .update({ status: 'canceled' })
          .eq('recurring_id', entity.id);
      }

      if (data.event === 'payment.captured') {
        const entity = data.payload.payment.entity;
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('user_id, id')
          .eq('recurring_id', entity.subscription_id)
          .single();

        await supabase.from('payments').insert({
          user_id: sub?.user_id ?? null,
          subscription_id: sub?.id ?? null,
          amount: entity.amount / 100,
          currency: entity.currency,
          payment_method: 'razorpay',
          external_payment_id: entity.id,
          status: 'success',
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { message: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}