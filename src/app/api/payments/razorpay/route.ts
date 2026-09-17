import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';
import { RAZORPAY_PLANS } from '@/lib/razorpay';
import {
  createRazorpaySubscription,
  createRazorpayCustomer,
} from '@/lib/razorpay';

type PlanKey = keyof typeof RAZORPAY_PLANS;

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { plan } = await req.json();

    if (!plan || !RAZORPAY_PLANS[plan as PlanKey]) {
      return NextResponse.json({ message: 'Invalid plan' }, { status: 400 });
    }

    const supabase = supabaseServer();
    const { data: user } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', userId)
      .single();

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    const planId = RAZORPAY_PLANS[plan as PlanKey].planId;
    if (planId === 'plan_xxxxx') {
      return NextResponse.json(
        { message: 'Razorpay plan not configured' },
        { status: 500 }
      );
    }

    const customer = await createRazorpayCustomer(
      user.email,
      user.full_name || 'User'
    );

    const subscription = await createRazorpaySubscription(planId, customer.id);

    await supabase.from('subscriptions').upsert(
      {
        user_id: userId,
        plan,
        status: 'pending',
        payment_method: 'razorpay',
        recurring_id: subscription.id,
        monthly_price: RAZORPAY_PLANS[plan as PlanKey].amount / 100, // paise → INR
        currency: 'inr',
      },
      { onConflict: 'recurring_id' }
    );

    return NextResponse.json({
      provider: 'razorpay',
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url,
    });
  } catch (error) {
    console.error('Razorpay payment error:', error);
    return NextResponse.json({ message: 'Razorpay payment failed' }, { status: 500 });
  }
}