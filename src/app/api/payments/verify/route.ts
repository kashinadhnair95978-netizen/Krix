import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import crypto from 'crypto';
import { getUserId } from '@/lib/auth-utils';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { provider, subscriptionId, razorpayPaymentId, razorpaySignature } =
      await req.json();
    const supabase = supabaseServer();

    if (provider === 'razorpay') {
      // Verify Razorpay payment signature
      const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
        .update(`${razorpayPaymentId}|${subscriptionId}`)
        .digest('hex');

      if (expected !== razorpaySignature) {
        return NextResponse.json(
          { message: 'Invalid payment signature' },
          { status: 400 }
        );
      }
    }

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        payment_id: razorpayPaymentId || undefined,
      })
      .eq('recurring_id', subscriptionId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !subscription) {
      return NextResponse.json(
        { message: error?.message || 'Subscription not found' },
        { status: 400 }
      );
    }

    return NextResponse.json({ message: 'Payment verified', subscription });
  } catch (error) {
    console.error('Verify payment error:', error);
    return NextResponse.json({ message: 'Verification failed' }, { status: 500 });
  }
}