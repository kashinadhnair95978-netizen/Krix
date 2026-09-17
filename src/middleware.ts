import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

function isProtectedPath(pathname: string): boolean {
  return (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/api/videos') ||
    pathname.startsWith('/api/upload') ||
    pathname.startsWith('/api/repurpose') ||
    pathname.startsWith('/api/subscription') ||
    pathname.startsWith('/api/ai')
  );
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Internal service-to-service calls (upload → process-video → repurpose)
  // carry no browser session, only a shared secret.
  const serviceKey = process.env.INTERNAL_SERVICE_KEY;
  const providedKey = req.headers.get('x-service-key');
  if (serviceKey && providedKey && providedKey === serviceKey) {
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
    '/api/repurpose/:path*',
    '/api/subscription/:path*',
    '/api/ai/:path*',
  ],
};