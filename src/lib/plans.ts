/**
 * Single source of truth for what Krix sells and what each payment provider
 * needs in order to sell it.
 *
 * Provider identifiers (Stripe price ids, Razorpay plan ids) are read from the
 * environment. There is deliberately no built-in fallback identifier: a
 * checkout that silently falls back to a placeholder would either charge the
 * wrong amount or create an unusable subscription, so every payment route fails
 * closed with an actionable message instead.
 */

export type PaidPlanKey = 'basic' | 'pro' | 'enterprise';

export interface PlanDefinition {
  key: PaidPlanKey;
  name: string;
  /** Minor units (cents) for Stripe. */
  amountUsd: number;
  /** Minor units (paise) for Razorpay. */
  amountInr: number;
  interval: 'month';
}

export const PLANS: Record<PaidPlanKey, PlanDefinition> = {
  basic: {
    key: 'basic',
    name: 'Basic',
    amountUsd: 1500,
    amountInr: 150000,
    interval: 'month',
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    amountUsd: 2400,
    amountInr: 240000,
    interval: 'month',
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    amountUsd: 7000,
    amountInr: 700000,
    interval: 'month',
  },
};

export const PLAN_KEYS = Object.keys(PLANS) as PaidPlanKey[];

export function isPlanKey(value: unknown): value is PaidPlanKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLANS, value);
}

/**
 * Values that look like credentials but are not. Anything matching is treated
 * as "not configured" so a copy-pasted `.env.example` can never authenticate,
 * charge, or silently succeed.
 */
export function isPlaceholderSecret(value: string | null | undefined): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (v.length < 8) return true;
  return (
    v.includes('xxxxx') ||
    v.includes('placeholder') ||
    v.includes('changeme') ||
    v.includes('your-') ||
    v.includes('[your')
  );
}

const STRIPE_PRICE_ENV: Record<PaidPlanKey, string> = {
  basic: 'STRIPE_PRICE_BASIC',
  pro: 'STRIPE_PRICE_PRO',
  enterprise: 'STRIPE_PRICE_ENTERPRISE',
};

const RAZORPAY_PLAN_ENV: Record<PaidPlanKey, string> = {
  basic: 'RAZORPAY_PLAN_BASIC',
  pro: 'RAZORPAY_PLAN_PRO',
  enterprise: 'RAZORPAY_PLAN_ENTERPRISE',
};

export function stripePriceId(plan: PaidPlanKey): string | null {
  const id = process.env[STRIPE_PRICE_ENV[plan]];
  return isPlaceholderSecret(id) ? null : (id as string).trim();
}

export function razorpayPlanId(plan: PaidPlanKey): string | null {
  const id = process.env[RAZORPAY_PLAN_ENV[plan]];
  return isPlaceholderSecret(id) ? null : (id as string).trim();
}

export function stripeSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return isPlaceholderSecret(key) ? null : (key as string).trim();
}

export function stripeWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  return isPlaceholderSecret(secret) ? null : (secret as string).trim();
}

export function razorpayKeySecret(): string | null {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  return isPlaceholderSecret(secret) ? null : (secret as string).trim();
}

export function razorpayKeyId(): string | null {
  const id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  return isPlaceholderSecret(id) ? null : (id as string).trim();
}

export interface ProviderReadiness {
  ready: boolean;
  /** Present only when `ready` is false. */
  reason?: string;
  /** Environment variables the operator must set, for the error message. */
  missing?: string[];
}

function stripeMissing(): string[] {
  const missing: string[] = [];
  if (!stripeSecretKey()) missing.push('STRIPE_SECRET_KEY');
  if (!stripeWebhookSecret()) missing.push('STRIPE_WEBHOOK_SECRET');
  for (const plan of PLAN_KEYS) {
    if (!stripePriceId(plan)) missing.push(STRIPE_PRICE_ENV[plan]);
  }
  return missing;
}

function razorpayMissing(): string[] {
  const missing: string[] = [];
  if (!razorpayKeyId()) missing.push('NEXT_PUBLIC_RAZORPAY_KEY_ID');
  if (!razorpayKeySecret()) missing.push('RAZORPAY_KEY_SECRET');
  for (const plan of PLAN_KEYS) {
    if (!razorpayPlanId(plan)) missing.push(RAZORPAY_PLAN_ENV[plan]);
  }
  return missing;
}

export function stripeReadiness(): ProviderReadiness {
  const missing = stripeMissing();
  if (missing.length === 0) return { ready: true };
  return {
    ready: false,
    missing,
    reason:
      'Stripe is not configured on this server. Set these environment variables to the live values from the Stripe dashboard ' +
      `(${missing.join(', ')}) and restart the app. Use Stripe test-mode keys (sk_test_...) while testing.`,
  };
}

export function razorpayReadiness(): ProviderReadiness {
  const missing = razorpayMissing();
  if (missing.length === 0) return { ready: true };
  return {
    ready: false,
    missing,
    reason:
      'Razorpay is not configured on this server. Set these environment variables to the live values from the Razorpay dashboard ' +
      `(${missing.join(', ')}) and restart the app. Use Razorpay test-mode keys (rzp_test_...) while testing.`,
  };
}

export type PaymentProvider = 'stripe' | 'razorpay';

export function isPaymentProvider(value: unknown): value is PaymentProvider {
  return value === 'stripe' || value === 'razorpay';
}

export function providerReadiness(provider: PaymentProvider): ProviderReadiness {
  return provider === 'stripe' ? stripeReadiness() : razorpayReadiness();
}
