import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserId } from '@/lib/auth-utils';
import { stripe } from '@/lib/stripe';

export async function PUT(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { paymentMethodId } = await req.json();

    if (!paymentMethodId) {
      return NextResponse.json(
        { message: 'paymentMethodId is required' },
        { status: 400 }
      );
    }

    const supabase = supabaseServer();

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('payment_method', 'stripe')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!subscription) {
      return NextResponse.json(
        { message: 'No Stripe subscription found' },
        { status: 404 }
      );
    }

    const paymentMethod = await stripe.paymentMethods.retrieve(
      paymentMethodId
    );
    const customerId = paymentMethod.customer as string;

    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    return NextResponse.json({ message: 'Payment method updated' });
  } catch (error) {
    console.error('Update payment method error:', error);
    return NextResponse.json(
      { message: 'Failed to update payment method' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  return PUT(req);
}