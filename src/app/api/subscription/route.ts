import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';
import { stripe } from '@/lib/stripe';
import { razorpay } from '@/lib/razorpay';

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const supabase = supabaseServer();

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // Single returns an error when no rows match; return null instead
      if ((error as any).code === 'PGRST116') {
        return NextResponse.json(null);
      }
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Get subscription error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const supabase = supabaseServer();

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!subscription) {
      return NextResponse.json(
        { message: 'No subscription found' },
        { status: 404 }
      );
    }

    if (subscription.payment_method === 'stripe') {
      await stripe.subscriptions.cancel(subscription.recurring_id);
    } else if (subscription.payment_method === 'razorpay') {
      await razorpay.subscriptions.cancel(subscription.recurring_id);
    }

    await supabase
      .from('subscriptions')
      .update({ status: 'canceled', cancel_at_period_end: true })
      .eq('id', subscription.id);

    return NextResponse.json({ message: 'Subscription canceled' });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return NextResponse.json(
      { message: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}