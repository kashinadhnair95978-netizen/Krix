import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isPlaceholderSecret } from '@/lib/plans';

/**
 * Constant-time string comparison.
 *
 * Inlined rather than imported from `@/lib/payment-security` because middleware
 * runs on the Edge runtime, where `node:crypto` is unavailable. The loop touches
 * every character regardless of where the first difference is, so the response
 * time does not leak the position of a correct prefix.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Payment paths that are intentionally reachable without a browser session.
 *
 *  - `/api/payments/webhook` is called by Stripe and Razorpay with no cookies;
 *    it authenticates with a provider signature instead.
 *  - `/api/payments/provider` only answers "which provider would this region
 *    use" so the pricing page can render before sign-in.
 *
 * Everything else under `/api/payments` requires a session.
 */
const PUBLIC_PAYMENT_PATHS = ['/api/payments/webhook', '/api/payments/provider'];

function isProtectedPath(pathname: string): boolean {
  if (PUBLIC_PAYMENT_PATHS.includes(pathname)) return false;
  return (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/api/videos') ||
    pathname.startsWith('/api/upload') ||
    pathname.startsWith('/api/ingest-url') ||
    pathname.startsWith('/api/repurpose') ||
    pathname.startsWith('/api/subscription') ||
    pathname.startsWith('/api/ai') ||
    pathname.startsWith('/api/pipeline') ||
    pathname.startsWith('/api/clips') ||
    // Defense in depth: these routes check the session themselves, but a route
    // that forgot its own check must not be exposed because of that.
    pathname.startsWith('/api/analytics') ||
    pathname.startsWith('/api/content') ||
    pathname.startsWith('/api/payments')
  );
}

/**
 * Fail closed before serving traffic: a production build that still carries the
 * `.env.example` service key would let anyone who has read this repository
 * impersonate internal service calls, so the process refuses to start.
 *
 * Skipped during `next build` (NEXT_PHASE === 'phase-production-build') so an
 * image can still be built without production secrets present.
 */
function assertProductionServiceKey() {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  if (!isPlaceholderSecret(process.env.INTERNAL_SERVICE_KEY)) return;
  throw new Error(
    'Refusing to start: INTERNAL_SERVICE_KEY is missing or still a placeholder ' +
      '("changeme"/"xxxxx"). Generate one with `openssl rand -hex 32` and set it ' +
      'before running a production build.'
  );
}

export async function middleware(req: NextRequest) {
  assertProductionServiceKey();

  const res = NextResponse.next();

  // Internal service-to-service calls (upload → process-video → repurpose)
  // carry no browser session, only a shared secret. A placeholder configured on
  // the server is never accepted, so a copied `.env.example` cannot authenticate.
  const serviceKey = process.env.INTERNAL_SERVICE_KEY;
  const providedKey = req.headers.get('x-service-key');
  if (!isPlaceholderSecret(serviceKey) && providedKey && safeEqual(providedKey, serviceKey as string)) {
    return res;
  }

  const protectedPath = isProtectedPath(req.nextUrl.pathname);

  // If Supabase isn't configured yet, fail closed on protected routes instead
  // of crashing every request with an invalid client.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || url.includes('placeholder') || anon.includes('placeholder')) {
    if (protectedPath) {
      if (req.nextUrl.pathname.startsWith('/api')) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = '/auth/login';
      redirectUrl.searchParams.set('redirectedFrom', req.nextUrl.pathname);
      return NextResponse.redirect(redirectUrl);
    }
    return res;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[]
      ) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (protectedPath && !user) {
    if (req.nextUrl.pathname.startsWith('/api')) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/auth/login';
    redirectUrl.searchParams.set('redirectedFrom', req.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // If a signed-in user visits a signup/login page, send them straight
  // into the app instead of showing the auth page again.
  if (user && req.nextUrl.pathname.startsWith('/auth/')) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

export const config = {
  matcher: [
    '/auth/:path*',
    '/dashboard/:path*',
    '/api/videos/:path*',
    '/api/upload/:path*',
    '/api/ingest-url/:path*',
    '/api/repurpose/:path*',
    '/api/subscription/:path*',
    '/api/ai/:path*',
    '/api/pipeline/:path*',
    '/api/clips/:path*',
    '/api/analytics/:path*',
    '/api/content/:path*',
    '/api/payments/:path*',
  ],
};
