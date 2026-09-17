'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupabase } from '@/lib/supabase';
import { Loading } from '@/components/ui/Loading';

export function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await browserSupabase.auth.getSession();

      if (!session) {
        router.replace('/auth/login');
      }
      setLoading(false);
    };
    checkAuth();
  }, [router]);

  if (loading) return <Loading />;

  return <>{children}</>;
}