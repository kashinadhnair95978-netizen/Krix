import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ message: 'Logged out' });

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && anon) {
      const cookieClient = createServerClient(url, anon, {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(
            cookiesToSet: { name: string; value: string; options: CookieOptions }[]
          ) {
            cookiesToSet.forEach(({ name, value, options }) =>
              res.cookies.set(name, value, options)
            );
          },
        },
      });
      await cookieClient.auth.signOut();
    }

    // Belt-and-braces: clear any remaining session cookies.
    const names = Array.from(
      new Set(
        req.cookies
          .getAll()
          .map((c) => c.name)
          .filter((n) => n.includes('supabase') || n.includes('sb-'))
      )
    );
    names.forEach((name) => res.cookies.set(name, '', { maxAge: 0 }));
    return res;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ message: 'Logout failed' }, { status: 500 });
  }
}