import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupabase } from './supabase';
import { apiClient } from './api-client';

export function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await browserSupabase.auth.getUser();
      if (data.user) {
        const { data: profile } = await browserSupabase
          .from('users')
          .select('*')
          .eq('id', data.user.id)
          .single();
        setUser(profile || data.user);
        if (typeof window !== 'undefined') {
          (window as any).__USER_ID__ = data.user.id;
        }
      } else {
        router.push('/auth/login');
      }
      setLoading(false);
    };

    checkAuth();

    const { data: listener } = browserSupabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          router.push('/auth/login');
        }
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [router]);

  return { user, loading };
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const response = await apiClient.getSubscription();
        setSubscription(response.data);
      } catch (error) {
        setSubscription(null);
      } finally {
        setLoading(false);
      }
    };

    fetchSubscription();
  }, []);

  return { subscription, loading };
}

export function useInterval(callback: () => void, delay: number | null) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
}

export function useAnalytics() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refetchIndex, setRefetchIndex] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchAnalytics = async () => {
      try {
        const response = await fetch('/api/analytics');
        if (!response.ok) throw new Error('Failed to load analytics');
        const data = await response.json();
        if (active) {
          setAnalytics(data);
          setLoading(false);
        }
      } catch (error) {
        if (active) setLoading(false);
      }
    };
    fetchAnalytics();
    return () => {
      active = false;
    };
  }, [refetchIndex]);

  const refetch = () => setRefetchIndex((i) => i + 1);

  return { analytics, loading, refetch };
}