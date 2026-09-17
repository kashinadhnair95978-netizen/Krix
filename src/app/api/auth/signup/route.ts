import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { message: 'Email, password, and name are required' },
        { status: 400 }
      );
    }

    const res = NextResponse.json({ message: 'Signup successful' });
    const supabase = supabaseServer();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Create auth user
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) {
      return NextResponse.json(
        { message: authError.message },
        { status: 400 }
      );
    }

    // Create user profile
    const { error: profileError } = await supabase.from('users').insert({
      id: authData.user.id,
      email,
      full_name: name,
      country_code: 'US', // Detect from IP in real app
    });

    if (profileError) {
      return NextResponse.json(
        { message: 'Failed to create profile' },
        { status: 400 }
      );
    }

    // Sign the new user in right away so they land straight in the app
    // and never see the login page after their first signup.
    if (url && anon && !anon.includes('placeholder')) {
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
      const { error: signInError } =
        await cookieClient.auth.signInWithPassword({ email, password });
      if (!signInError) {
        return res;
      }
      console.error('Post-signup auto-login failed:', signInError.message);
    }

    return NextResponse.json({ message: 'Signup successful' });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}