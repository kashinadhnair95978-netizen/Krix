import crypto from 'crypto';

/**
 * Shared primitives for the billing surface.
 *
 * Two rules hold everywhere in this file:
 *   1. a client may propose *which* record to act on, never *that* the record is
 *      valid — validity comes from a provider signature or a provider API read;
 *   2. every secret comparison is constant time, so a timing oracle cannot be
 *      used to reconstruct a key or a signature one byte at a time.
 */

/** Constant-time string comparison. Length differences are not secret here. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Razorpay's documented scheme: HMAC_SHA256(`<order_id>|<payment_id>`, key_secret)
 * must equal the `razorpay_signature` the browser returned.
 *
 * The previous implementation signed `<payment_id>|<subscription_id>`, which
 * never matches, and compared with `!==`.
 */
export function verifyRazorpaySignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  const { orderId, paymentId, signature, keySecret } = args;
  if (!orderId || !paymentId || !signature) return false;
  const expected = hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);
  return safeEqual(expected, signature);
}

/**
 * Uniform error body. Every payment route answers with `{ error, message }` so
 * the client can branch on a stable code, and never with a stack trace.
 */
export function paymentError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
) {
  return { status, body: { error: code, message, ...(extra ?? {}) } };
}
