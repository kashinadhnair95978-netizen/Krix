'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { browserSupabase } from '@/lib/supabase';
import { Loading } from '@/components/ui/Loading';

type Phase = 'working' | 'failed';

export default function AuthCallback() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fail = (text: string) => {
      if (cancelled) return;
      setMessage(text);
      setPhase('failed');
    };

    const handleCallback = async () => {
      // The provider redirect carries `?code=...&state=...`. The previous code
      // sliced the whole query string and handed `code=...&state=...` to
      // exchangeCodeForSession, which expects the bare code — so every Google
      // sign-in failed.
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const providerError = params.get('error_description') || params.get('error');

      if (providerError) {
        fail(providerError);
        return;
      }
      if (!code) {
        fail('This sign-in link is missing its authorization code. Start the sign-in again.');
        return;
      }

      const { error } = await browserSupabase.auth.exchangeCodeForSession(code);
      if (error) {
        fail(error.message || 'Google sign-in could not be completed.');
        return;
      }

      // Do not race the session write: the old code waited 200 ms and then
      // navigated, which intermittently produced a signed-out dashboard.
      const { data } = await browserSupabase.auth.getSession();
      if (!data.session) {
        fail('Google sign-in completed but no session was created. Please try again.');
        return;
      }

      // OAuth users have no profile row yet — create one.
      try {
        await fetch('/api/auth/upsert-profile', { method: 'POST' });
      } catch (err) {
        console.error('Could not upsert profile:', err);
      }

      const pendingUrl = window.sessionStorage.getItem('krix_pending_url');
      if (pendingUrl) {
        window.sessionStorage.removeItem('krix_pending_url');
        router.replace(`/dashboard/upload?url=${encodeURIComponent(pendingUrl)}`);
      } else {
        router.replace('/dashboard');
      }
    };

    void handleCallback();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (phase === 'failed') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <p className="text-sm text-neutral-400">Sign-in failed</p>
        <p className="max-w-sm text-sm text-neutral-200">{message}</p>
        <Link
          href="/auth/login"
          className="rounded-full bg-white px-6 py-2 text-sm font-medium text-black hover:bg-neutral-200"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <Loading text="Signing you in..." />
    </div>
  );
}
