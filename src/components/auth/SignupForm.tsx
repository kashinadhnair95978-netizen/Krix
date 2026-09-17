'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await apiClient.signup(email, password, name);

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
      const message =
        err?.response?.data?.message || err?.message || 'Signup failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm mx-auto">
      <Input
        label="Name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Jane Doe"
        required
      />
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
        minLength={6}
        required
      />

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <Button
        type="submit"
        disabled={loading}
        className="w-full"
        loading={loading}
      >
        {loading ? 'Creating account...' : 'Sign Up'}
      </Button>
    </form>
  );
}