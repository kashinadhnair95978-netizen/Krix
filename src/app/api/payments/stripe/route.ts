import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';
import { STRIPE_PLANS, stripe } from '@/lib/stripe';

type PlanKey = keyof typeof STRIPE_PLANS;

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { plan, paymentMethodId } = await req.json();

    if (!plan || !STRIPE_PLANS[plan as PlanKey]) {
      return NextResponse.json({ message: 'Invalid plan' }, { status: 400 });
    }

    const supabase = supabaseServer();
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    const priceId = STRIPE_PLANS[plan as PlanKey].priceId;
    if (priceId === 'price_xxxxx') {
      return NextResponse.json(
        { message: 'Stripe price not configured' },
        { status: 500 }
      );
    }

    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId },
      ...(paymentMethodId ? { payment_method: paymentMethodId } : {}),
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    const latestInvoice = subscription.latest_invoice as
      | Stripe.Invoice
      | null
      | undefined;

    await supabase.from('subscriptions').upsert(
      {
        user_id: userId,
        plan,
        status: 'pending',
        payment_method: 'stripe',
        recurring_id: subscription.id,
        payment_id: latestInvoice?.id,
        monthly_price: STRIPE_PLANS[plan as PlanKey].amount / 100,
        currency: 'usd',
      },
      { onConflict: 'recurring_id' }
    );

    return NextResponse.json({
      provider: 'stripe',
      subscriptionId: subscription.id,
      clientSecret: (latestInvoice?.payment_intent as any)?.client_secret,
    });
  } catch (error) {
    console.error('Stripe payment error:', error);
    return NextResponse.json({ message: 'Stripe payment failed' }, { status: 500 });
  }
}