/**
 * Fixed-window rate limiter for the unauthenticated auth endpoints.
 *
 * Scope, stated plainly: this is an in-process counter. It stops credential
 * stuffing and mass account creation against a single running instance, which is
 * the deployment shape this app uses (one Next.js server plus the Python
 * worker). It is NOT a distributed limiter — behind a multi-instance or
 * serverless deployment each instance keeps its own window, so the effective
 * limit scales with instance count. Swapping the store for Redis/Upstash is the
 * documented upgrade path and requires no change to the call sites.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-running process. */
const MAX_BUCKETS = 10_000;

function sweep(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Test seam: drops all counters. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function clientIp(req: {
  headers: { get(name: string): string | null };
}): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

const MINUTE = 60_000;

export const AUTH_LIMITS = {
  login: { perIp: 20, perEmail: 10, windowMs: 15 * MINUTE },
  signup: { perIp: 10, perEmail: 5, windowMs: 60 * MINUTE },
} as const;
