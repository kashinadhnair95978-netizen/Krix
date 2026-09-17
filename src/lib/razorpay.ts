import Razorpay from 'razorpay';

// Placeholder to keep the module importable before env vars are set.
export const razorpay = new Razorpay({
  key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_placeholder',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret',
});

export const RAZORPAY_PLANS = {
  basic: {
    planId: 'plan_xxxxx', // Create in Razorpay Dashboard
    amount: 2900 * 100, // ₹2900 in paise
    interval: 12, // Monthly
  },
  pro: {
    planId: 'plan_xxxxx',
    amount: 5900 * 100,
    interval: 12,
  },
  enterprise: {
    planId: 'plan_xxxxx',
    amount: 9900 * 100,
    interval: 12,
  },
} as const;

export interface RazorpayCustomerResult {
  id: string;
  entity: string;
  name: string;
  email: string;
  contact: string | null;
}

export interface RazorpaySubscriptionResult {
  id: string;
  entity: string;
  status: string;
  plan_id: string;
  customer_id: string | null;
  short_url: string;
  total_count: number;
  paid_count: number;
  created_at: number;
}

export async function createRazorpayCustomer(
  email: string,
  name: string
): Promise<RazorpayCustomerResult> {
  const customer = (await razorpay.customers.create({
    email,
    name,
  } as any)) as RazorpayCustomerResult;
  return customer;
}

export async function createRazorpaySubscription(
  planId: string,
  customerId: string
): Promise<RazorpaySubscriptionResult> {
  const subscription = (await razorpay.subscriptions.create({
    plan_id: planId,
    customer_id: customerId,
    total_count: 0, // Infinite
  } as any)) as RazorpaySubscriptionResult;
  return subscription;
}