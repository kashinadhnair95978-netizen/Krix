import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { AUTH_LIMITS, clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { message: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Metered before Supabase is called: otherwise this endpoint is an unlimited
    // credential-stuffing oracle (it also answers differently for a missing
    // account, a wrong password, and a rate-limited caller).
    const normalizedEmail = String(email).trim().toLowerCase();
    const limits = AUTH_LIMITS.login;
    const verdicts = [
      rateLimit(`login:ip:${clientIp(req)}`, limits.perIp, limits.windowMs),
      rateLimit(`login:email:${normalizedEmail}`, limits.perEmail, limits.windowMs),
    ];
    const blocked = verdicts.find((v) => !v.allowed);
    if (blocked) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message: 'Too many sign-in attempts. Wait a few minutes and try again.',
        },
        { status: 429, headers: { 'Retry-After': String(blocked.retryAfterSeconds) } }
      );
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    return NextResponse.json({
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
