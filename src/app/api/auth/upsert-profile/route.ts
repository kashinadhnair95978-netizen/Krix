import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (
      !url ||
      !anon ||
      url.includes('placeholder') ||
      anon.includes('placeholder')
    ) {
      return NextResponse.json({ message: 'Not configured' }, { status: 500 });
    }

    const cookieClient = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          // Read-only: we only need to resolve the current session.
          cookiesToSet.forEach(() => {});
        },
      },
    });

    const {
      data: { user },
    } = await cookieClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const meta = user.user_metadata || {};
    const { error } = await supabaseServer()
      .from('users')
      .upsert(
        {
          id: user.id,
          email: user.email || '',
          full_name: meta.full_name || meta.name || null,
          avatar_url: meta.avatar_url || meta.picture || null,
        },
        { onConflict: 'id' }
      );

    if (error) {
      // Not fatal — the profile row may already exist.
      console.error('Profile upsert error:', error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Upsert profile error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}