import Stripe from 'stripe';
import { stripeSecretKey } from './plans';

/**
 * Stripe client holder.
 *
 * The SDK is constructed with a syntactically valid but useless key so the
 * module stays importable during `next build` and in tests. Nothing may use
 * this export: call `getStripe()`, which fails closed when the real key is
 * missing or is still a `.env.example` placeholder.
 */
let cached: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  readonly code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'StripeNotConfiguredError';
  }
}

export function isStripeConfigured(): boolean {
  return stripeSecretKey() !== null;
}

export function getStripe(): Stripe {
  const key = stripeSecretKey();
  if (!key) {
    throw new StripeNotConfiguredError(
      'STRIPE_SECRET_KEY is not set (or is still a placeholder). Checkout is unavailable until it is configured.'
    );
  }
  if (!cached) {
    cached = new Stripe(key);
  }
  return cached;
}

export { PLANS as STRIPE_PLANS } from './plans';
