import Stripe from 'stripe';

// Placeholder to keep the module importable before env vars are set.
export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder'
);

export const STRIPE_PLANS = {
  basic: {
    priceId: 'price_xxxxx', // Create in Stripe Dashboard
    amount: 2900, // $29
    interval: 'month',
  },
  pro: {
    priceId: 'price_xxxxx',
    amount: 5900, // $59
    interval: 'month',
  },
  enterprise: {
    priceId: 'price_xxxxx',
    amount: 9900, // $99
    interval: 'month',
  },
} as const;

export async function createStripeCustomer(email: string, userId: string) {
  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });
  return customer;
}

export async function createStripeSubscription(
  customerId: string,
  priceId: string
) {
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  });
  return subscription;
}