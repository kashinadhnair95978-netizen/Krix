'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { PaymentSelector } from '@/components/supabase/payment/PaymentSelector';
import { Modal } from '@/components/ui/Modal';
import { Check } from '@/components/landing/icons';

const plans = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    annual: 0,
    priceInrMonthly: 0,
    priceInrAnnual: 0,
    description: 'Everything you need to try Krix.',
    features: [
      '3 videos per month',
      'Basic repurposing formats',
      'Watermarked exports',
      'Community support',
    ],
    highlight: false,
  },
  {
    id: 'basic',
    name: 'Basic',
    monthly: 15,
    annual: 12,
    priceInrMonthly: 1500,
    priceInrAnnual: 1200,
    description: 'Perfect for getting started.',
    features: [
      '10 videos per month',
      'All repurposing formats',
      'No watermark',
      'Community support',
    ],
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 24,
    annual: 19,
    priceInrMonthly: 2400,
    priceInrAnnual: 1900,
    description: 'For creators who post everywhere.',
    features: [
      'Unlimited videos',
      'All formats',
      'Priority support',
      'AI custom branding',
      'Advanced analytics',
    ],
    highlight: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthly: 70,
    annual: 56,
    priceInrMonthly: 7000,
    priceInrAnnual: 5600,
    description: 'For teams and agencies.',
    features: [
      'Everything in Pro',
      'Custom AI training',
      'API access',
      'Dedicated support',
      '24/7 phone support',
    ],
    highlight: false,
  },
];

/**
 * What the server says about the subscription, never what the browser claims.
 * `active` is only ever set from a verified server response.
 */
type SubscriptionState = {
  status: string;
  plan?: string;
  paymentMethod?: string;
} | null;

type CheckoutOutcome =
  | { kind: 'active'; provider: string; plan: string | null }
  | { kind: 'processing'; provider: string; detail: string }
  | { kind: 'cancelled'; provider: string; detail: string };

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelect = (planId: string) => setSelectedPlan(planId);

  const readSubscription = useCallback(async (): Promise<SubscriptionState> => {
    const res = await fetch('/api/subscription', { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as SubscriptionState;
  }, []);

  /**
   * Poll the server for the subscription Stripe/Razorpay activated. Webhooks are
   * asynchronous, so "still pending" is a real, honest answer — not a failure and
   * not a fake success.
   */
  const pollForActivation = useCallback(
    (provider: string, attemptsLeft = 10) => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      const tick = async () => {
        const subscription = await readSubscription().catch(() => null);
        if (subscription?.status === 'active') {
          setOutcome({ kind: 'active', provider, plan: subscription.plan ?? null });
          return;
        }
        if (attemptsLeft <= 1) {
          setOutcome({
            kind: 'processing',
            provider,
            detail:
              subscription?.status === 'pending'
                ? 'Your payment was taken and the subscription is recorded. It becomes active as soon as the provider confirms it — this page will reflect it on your dashboard.'
                : 'We have not received a confirmation for this payment yet. If you were charged, your plan will appear in the dashboard once the provider confirms it.',
          });
          return;
        }
        pollTimer.current = setTimeout(tick, 2000);
      };
      void tick();
    },
    [readSubscription]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (checkout === 'success') {
      pollForActivation('stripe');
    } else if (checkout === 'cancelled') {
      setOutcome({
        kind: 'cancelled',
        provider: 'stripe',
        detail: 'You left Stripe Checkout without paying. Nothing was charged.',
      });
    }
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [pollForActivation]);

  const handleComplete = (result: { provider: string; status: string }) => {
    setSelectedPlan(null);
    if (result.status === 'active') {
      setOutcome({ kind: 'active', provider: result.provider, plan: null });
    } else {
      pollForActivation(result.provider);
    }
  };

  const selected = plans.find((p) => p.id === selectedPlan);
  const isFree = (planId: string) => planId === 'free';

  return (
    <main className="min-h-screen bg-black text-white">
      <Navbar />

      <section className="pb-24 pt-28 md:pb-32 md:pt-32">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-white md:text-6xl md:leading-tight">
              Simple, transparent pricing.
            </h1>
            <p className="mt-5 text-lg text-neutral-400">
              Start free. Upgrade when you&apos;re ready. Cancel anytime.
            </p>
          </div>

          <div className="mt-10 flex justify-center">
            <div className="relative inline-flex items-center rounded-full bg-white/[0.06] p-1 text-sm font-medium text-neutral-400">
              <span
                className={cn(
                  'absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-sm transition-transform duration-300 ease-out',
                  annual && 'translate-x-full'
                )}
              />
              <button
                onClick={() => setAnnual(false)}
                className={cn(
                  'relative z-10 w-28 rounded-full py-2 transition-colors',
                  !annual ? 'text-black' : 'hover:text-neutral-200'
                )}
              >
                Monthly
              </button>
              <button
                onClick={() => setAnnual(true)}
                className={cn(
                  'relative z-10 w-28 rounded-full py-2 transition-colors',
                  annual ? 'text-black' : 'hover:text-neutral-200'
                )}
              >
                Annual
              </button>
            </div>
          </div>
          <p className="-mt-5 mb-16 text-center text-xs text-neutral-600 md:mb-20">
            {annual ? 'Billed annually — save 20%.' : 'Save 20% when billed annually.'}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4">
            {plans.map((plan) => {
              const price = annual ? plan.annual : plan.monthly;
              return (
                <div
                  key={plan.id}
                  className={cn(
                    'relative flex flex-col rounded-3xl border bg-[#0d0d0f] p-6 md:p-8',
                    plan.highlight
                      ? 'border-white shadow-[0_20px_80px_-15px_rgba(255,255,255,0.15)]'
                      : 'border-white/10'
                  )}
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 left-8 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                      Most popular
                    </span>
                  )}

                  <h3 className="text-xl font-semibold tracking-tight text-white">
                    {plan.name}
                  </h3>
                  <p className="mt-1 text-sm text-neutral-500">
                    {plan.description}
                  </p>

                  <div className="mt-7 flex items-end gap-1">
                    <span className="text-5xl font-semibold tracking-tight text-white">
                      ${price}
                    </span>
                    <span className="mb-1.5 text-sm text-neutral-500">/month</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-600">
                    {annual ? 'billed annually' : 'billed monthly'}
                  </p>

                  {isFree(plan.id) ? (
                    <Link
                      href="/auth/signup"
                      className={cn(
                        'mt-8 flex w-full items-center justify-center rounded-full py-3 text-sm font-medium transition-colors',
                        'border border-white/20 text-white hover:bg-white/5'
                      )}
                    >
                      Start for free
                    </Link>
                  ) : (
                    <button
                      onClick={() => handleSelect(plan.id)}
                      className={cn(
                        'mt-8 flex w-full items-center justify-center rounded-full py-3 text-sm font-medium transition-colors',
                        plan.highlight
                          ? 'bg-white text-black hover:bg-neutral-200'
                          : 'border border-white/20 text-white hover:bg-white/5'
                      )}
                    >
                      Choose {plan.name}
                    </button>
                  )}

                  <ul className="mt-8 space-y-3 border-t border-white/10 pt-8">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-3 text-sm text-neutral-300"
                      >
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-white" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <p className="mt-10 text-center text-sm text-neutral-600">
            Need help choosing?{' '}
            <Link
              href="#faq"
              className="text-neutral-400 hover:text-white hover:underline"
            >
              Read the FAQ
            </Link>
          </p>
        </div>
      </section>

      {/* Payment modal */}
      <Modal
        open={selectedPlan !== null}
        onClose={() => setSelectedPlan(null)}
        title="Choose your payment method"
      >
        {selected && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-neutral-100 p-4">
              <p className="text-sm text-neutral-600">
                <span className="font-semibold text-black">{selected.name}</span>
                {' — '}${annual ? selected.annual : selected.monthly}/month
                {annual ? ' (billed annually)' : ''}
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                You will be asked to sign in first. Your plan is only upgraded after the payment
                provider confirms the payment.
              </p>
            </div>
            <PaymentSelector
              plan={selected.id}
              amountUsd={annual ? selected.annual : selected.monthly}
              amountInr={annual ? selected.priceInrAnnual : selected.priceInrMonthly}
              onComplete={handleComplete}
            />
          </div>
        )}
      </Modal>

      {/* Checkout outcome — every branch is driven by a server response */}
      <Modal
        open={outcome !== null}
        onClose={() => setOutcome(null)}
        title={
          outcome?.kind === 'active'
            ? 'Your plan is active'
            : outcome?.kind === 'cancelled'
              ? 'Checkout cancelled'
              : 'Payment received'
        }
      >
        <div className="space-y-4 text-center">
          {outcome?.kind === 'active' && (
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-black text-white">
              <Check className="h-7 w-7" />
            </div>
          )}
          <p className="text-neutral-600">
            {outcome?.kind === 'active' && (
              <>
                {outcome.plan ? (
                  <>
                    Your <span className="font-semibold capitalize text-black">{outcome.plan}</span> plan
                    is active
                  </>
                ) : (
                  'Your plan is active'
                )}{' '}
                via <span className="font-semibold capitalize text-black">{outcome.provider}</span>. It is
                already active on your account.
              </>
            )}
            {outcome?.kind === 'processing' && outcome.detail}
            {outcome?.kind === 'cancelled' && outcome.detail}
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href="/dashboard/settings"
              className="inline-flex w-full items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
            >
              View my plan
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex w-full items-center justify-center rounded-full border border-neutral-300 px-6 py-3 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </Modal>

      <Footer />
    </main>
  );
}