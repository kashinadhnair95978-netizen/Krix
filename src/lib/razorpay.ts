import Razorpay from 'razorpay';
import { razorpayKeyId, razorpayKeySecret } from './plans';

export class RazorpayNotConfiguredError extends Error {
  readonly code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'RazorpayNotConfiguredError';
  }
}

export function isRazorpayConfigured(): boolean {
  return razorpayKeyId() !== null && razorpayKeySecret() !== null;
}

/**
 * Fail-closed Razorpay client. Never falls back to a placeholder key: a
 * placeholder that "works" would produce unverifiable signatures.
 */
let cached: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  const keyId = razorpayKeyId();
  const keySecret = razorpayKeySecret();
  if (!keyId || !keySecret) {
    throw new RazorpayNotConfiguredError(
      'Razorpay credentials are not set (or are still placeholders). Checkout is unavailable until they are configured.'
    );
  }
  if (!cached) {
    cached = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return cached;
}

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

export interface RazorpayPaymentResult {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  international: boolean;
  method: string | null;
  subscription_id: string | null;
  invoice_id: string | null;
  order_id: string | null;
}

export async function createRazorpayCustomer(
  email: string,
  name: string
): Promise<RazorpayCustomerResult> {
  const customer = (await getRazorpay().customers.create({
    email,
    name,
  } as never)) as RazorpayCustomerResult;
  return customer;
}

export async function createRazorpaySubscription(
  planId: string,
  customerId: string
): Promise<RazorpaySubscriptionResult> {
  const subscription = (await getRazorpay().subscriptions.create({
    plan_id: planId,
    customer_id: customerId,
    total_count: 0,
  } as never)) as RazorpaySubscriptionResult;
  return subscription;
}

/**
 * Authoritative read of a payment from Razorpay. The client never gets to say
 * whether a payment succeeded; this call does.
 */
export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPaymentResult> {
  const payment = (await getRazorpay().payments.fetch(paymentId)) as unknown as RazorpayPaymentResult;
  return payment;
}

export async function fetchRazorpaySubscription(
  subscriptionId: string
): Promise<RazorpaySubscriptionResult> {
  const subscription = (await getRazorpay().subscriptions.fetch(
    subscriptionId
  )) as unknown as RazorpaySubscriptionResult;
  return subscription;
}
