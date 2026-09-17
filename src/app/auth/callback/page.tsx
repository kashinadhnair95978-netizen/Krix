'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupabase } from '@/lib/supabase';
import { Loading } from '@/components/ui/Loading';

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      const { error } = await browserSupabase.auth.exchangeCodeForSession(
        window.location.search.includes('code=') ? window.location.search.slice(1) : ''
      );

      if (error) {
        console.error('Auth callback error:', error);
        router.replace('/auth/login?error=auth_failed');
        return;
      }

      router.replace('/dashboard');
    };

    // Wait a tick so the session cookie is set
    const timeout = setTimeout(handleCallback, 200);
    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <Loading text="Signing you in..." />
    </div>
  );
}