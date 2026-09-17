'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: signInError } = await browserSupabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw new Error(signInError.message);
      }

      const pendingUrl =
        typeof window !== 'undefined'
          ? window.sessionStorage.getItem('krix_pending_url')
          : null;
      if (pendingUrl) {
        window.sessionStorage.removeItem('krix_pending_url');
        router.push(`/dashboard/upload?url=${encodeURIComponent(pendingUrl)}`);
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        required
      />

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <Button
        type="submit"
        disabled={loading}
        className="w-full"
        loading={loading}
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </Button>
    </form>
  );
}