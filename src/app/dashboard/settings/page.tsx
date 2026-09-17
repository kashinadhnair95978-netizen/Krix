'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { browserSupabase } from '@/lib/supabase';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState('');
  const [aiStatus, setAiStatus] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await browserSupabase.auth.getUser();
      if (!user) {
        router.replace('/auth/login');
        return;
      }

      try {
        const res = await fetch('/api/ai/config');
        if (res.ok) {
          const data = await res.json();
          setAiStatus(data.status);
        }
      } catch {
        // AI status is informational; ignore failures
      }

      const { data: profileData } = await browserSupabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);
      setName(profileData?.full_name || '');

      const { data: sub } = await browserSupabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      setSubscription(sub || null);
      setLoading(false);
    };
    load();
  }, [router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const {
        data: { user },
      } = await browserSupabase.auth.getUser();
      await browserSupabase
        .from('users')
        .update({ full_name: name })
        .eq('id', user!.id);
      await browserSupabase.auth.updateUser({ data: { full_name: name } });
      setMessage('Profile updated successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm('Are you sure you want to cancel your subscription?')) return;
    setCanceling(true);
    setMessage('');
    setError('');
    try {
      await apiClient.cancelSubscription();
      setSubscription((prev: any) => ({ ...prev, status: 'canceled' }));
      setMessage(
        'Subscription canceled. You still have access until the end of the period.'
      );
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to cancel subscription');
    } finally {
      setCanceling(false);
    }
  };

  const handleLogout = async () => {
    await browserSupabase.auth.signOut();
    router.push('/');
  };

  if (loading)
    return <div className="py-12 text-center text-neutral-400">Loading...</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-8 animate-fade-up">
      <PageHeader
        title="Settings"
        subtitle="Manage your profile, subscription, and account."
      />

      {message && (
        <div className="rounded-xl border border-green-400/20 bg-green-400/5 px-4 py-3 text-sm text-green-300">
          ✓ {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <Card variant="dark" title="Profile">
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Email"
            variant="dark"
            type="email"
            value={profile?.email || ''}
            disabled
          />
          <Input
            label="Full name"
            variant="dark"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
          />
          <Button type="submit" inverse loading={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </form>
      </Card>

      <Card variant="dark" title="AI provider">
        {aiStatus ? (
          aiStatus.configured ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">{aiStatus.label}</p>
                <p className="text-sm text-neutral-400">
                  Model: <code className="text-neutral-300">{aiStatus.model}</code>
                  {aiStatus.baseUrl ? ` · ${aiStatus.baseUrl}` : ''}
                </p>
              </div>
              <span className="rounded-full bg-green-400/10 px-2.5 py-1 text-xs font-medium text-green-300 ring-1 ring-green-400/30">
                Connected
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-neutral-400">
                No AI provider is configured yet. Add any one of these API keys
                to your environment:
              </p>
              <ul className="space-y-2">
                {[
                  ['ANTHROPIC_API_KEY', 'Claude (Anthropic)'],
                  ['OPENAI_API_KEY', 'OpenAI (GPT)'],
                  ['GEMINI_API_KEY', 'Google Gemini'],
                  ['OPENROUTER_API_KEY', 'OpenRouter (any model)'],
                  ['AI_API_KEY + AI_BASE_URL', 'Custom OpenAI-compatible'],
                ].map(([key, label]) => (
                  <li
                    key={key}
                    className="flex items-center justify-between text-sm text-neutral-500"
                  >
                    <code className="text-neutral-300">{key}</code>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-neutral-600">
                Set <code>AI_PROVIDER</code> to choose one explicitly, or leave
                it as <code>auto</code> to use the first key found. Pick the
                model with <code>AI_MODEL</code> or a provider-specific one
                like <code>OPENAI_MODEL</code>.
              </p>
            </div>
          )
        ) : (
          <p className="text-sm text-neutral-400">Loading AI configuration...</p>
        )}
      </Card>

      <Card variant="dark" title="Subscription">
        {subscription ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold capitalize text-white">
                  {subscription.plan} plan
                </p>
                <p className="text-sm text-neutral-400">
                  {Number(subscription.monthly_price).toFixed(2)}{' '}
                  {subscription.currency?.toUpperCase()}/month
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                  subscription.status === 'active'
                    ? 'bg-green-400/10 text-green-300 ring-green-400/30'
                    : 'bg-white/5 text-neutral-400 ring-white/10'
                }`}
              >
                {subscription.status}
              </span>
            </div>

            {subscription.current_period_end && (
              <p className="text-sm text-neutral-400">
                Renews on{' '}
                {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            )}

            {subscription.status === 'active' && (
              <Button
                variant="outline"
                inverse
                onClick={handleCancelSubscription}
                loading={canceling}
                className="border-red-400/30 text-red-300 hover:bg-red-400/10"
              >
                {canceling ? 'Canceling...' : 'Cancel subscription'}
              </Button>
            )}

            <a
              href="/pricing"
              className="inline-block text-sm text-neutral-400 underline decoration-neutral-600 underline-offset-2 hover:text-white"
            >
              Upgrade or change plan →
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-neutral-400">
              No active subscription. Upgrade to unlock unlimited repurposing.
            </p>
            <a href="/pricing">
              <Button inverse>See pricing</Button>
            </a>
          </div>
        )}
      </Card>

      <Card variant="dark" title="Account">
        <Button
          variant="outline"
          inverse
          onClick={handleLogout}
          className="text-red-300 border-red-400/30 hover:bg-red-400/10"
        >
          Log out
        </Button>
      </Card>
    </div>
  );
}