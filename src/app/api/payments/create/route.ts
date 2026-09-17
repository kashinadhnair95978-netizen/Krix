import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseServer } from '@/lib/supabase';
import { detectCountry, getPaymentProvider } from '@/lib/geoip';
import { getUserId } from '@/lib/auth-utils';
import {
  createStripeSubscription,
  createStripeCustomer,
  STRIPE_PLANS,
} from '@/lib/stripe';
import {
  createRazorpaySubscription,
  createRazorpayCustomer,
  RAZORPAY_PLANS,
} from '@/lib/razorpay';

type PlanKey = keyof typeof STRIPE_PLANS;

export async function POST(req: NextRequest) {
  try {
    const { plan } = await req.json();

    if (!plan || !STRIPE_PLANS[plan as PlanKey]) {
      return NextResponse.json({ message: 'Invalid plan' }, { status: 400 });
    }

    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Detect country and payment provider
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '';
    const country =
      ip && ip !== '::1' && ip !== '127.0.0.1'
        ? await detectCountry(ip)
        : 'US';
    const provider = getPaymentProvider(country);

    const supabase = supabaseServer();
    const { data: user } = await supabase
      .from('users')
      .select('email, full_name, id')
      .eq('id', userId)
      .single();

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    if (provider === 'stripe') {
      const priceId = STRIPE_PLANS[plan as PlanKey].priceId;
      if (priceId === 'price_xxxxx') {
        return NextResponse.json(
          { message: 'Stripe price not configured. Set up STRIPE_PLANS.' },
          { status: 500 }
        );
      }

      const customer = await createStripeCustomer(user.email, userId);
      const subscription = await createStripeSubscription(customer.id, priceId);
      const latestInvoice = subscription.latest_invoice as
        | Stripe.Invoice
        | null
        | undefined;

      // Record intent
      await supabase.from('subscriptions').insert({
        user_id: userId,
        plan,
        status: 'pending',
        payment_method: 'stripe',
        recurring_id: subscription.id,
        payment_id: latestInvoice?.id,
        monthly_price: STRIPE_PLANS[plan as PlanKey].amount / 100,
        currency: 'usd',
      });

      return NextResponse.json({
        provider: 'stripe',
        subscriptionId: subscription.id,
        clientSecret: (latestInvoice?.payment_intent as any)?.client_secret,
      });
    } else {
      const planId = RAZORPAY_PLANS[plan as PlanKey].planId;
      if (planId === 'plan_xxxxx') {
        return NextResponse.json(
          { message: 'Razorpay plan not configured. Set up RAZORPAY_PLANS.' },
          { status: 500 }
        );
      }

      const customer = await createRazorpayCustomer(
        user.email,
        user.full_name || 'User'
      );
      const subscription = await createRazorpaySubscription(
        planId,
        customer.id
      );

      // Record intent
      await supabase.from('subscriptions').insert({
        user_id: userId,
        plan,
        status: 'pending',
        payment_method: 'razorpay',
        recurring_id: subscription.id,
        monthly_price:
          RAZORPAY_PLANS[plan as PlanKey].amount / 100, // paise → INR
        currency: 'inr',
      });

      return NextResponse.json({
        provider: 'razorpay',
        subscriptionId: subscription.id,
        shortUrl: subscription.short_url,
      });
    }
  } catch (error) {
    console.error('Payment creation error:', error);
    return NextResponse.json({ message: 'Payment creation failed' }, { status: 500 });
  }
}