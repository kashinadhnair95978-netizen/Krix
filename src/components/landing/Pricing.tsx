'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check } from './icons';

interface Plan {
  name: string;
  monthly: number;
  annual: number;
  description: string;
  features: string[];
  cta: string;
  highlight: boolean;
}

const plans: Plan[] = [
  {
    name: 'Basic',
    monthly: 29,
    annual: 23,
    description: 'Perfect for getting started.',
    features: [
      '10 videos per month',
      'All repurposing formats',
      'No watermark',
      'Community support',
    ],
    cta: 'Get started',
    highlight: false,
  },
  {
    name: 'Pro',
    monthly: 59,
    annual: 47,
    description: 'For creators who post everywhere.',
    features: [
      'Unlimited videos',
      'All formats',
      'Priority support',
      'AI custom branding',
      'Advanced analytics',
    ],
    cta: 'Start free trial',
    highlight: true,
  },
  {
    name: 'Enterprise',
    monthly: 99,
    annual: 79,
    description: 'For teams and agencies.',
    features: [
      'Everything in Pro',
      'Custom AI training',
      'API access',
      'Dedicated support',
      '24/7 phone support',
    ],
    cta: 'Contact sales',
    highlight: false,
  },
];

export function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="pricing" className="bg-black py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight text-white md:text-5xl md:leading-tight">
            Simple, transparent pricing.
          </h2>
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
        <p className="-mt-6 mb-16 text-center text-xs text-neutral-600 md:mb-20">
          {annual ? 'Billed annually — save 20%.' : 'Save 20% when billed annually.'}
        </p>

        <div className="grid gap-6 md:grid-cols-3 md:gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                'relative flex flex-col rounded-3xl border bg-[#0d0d0f] p-8 md:p-10',
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
              <p className="mt-1 text-sm text-neutral-500">{plan.description}</p>

              <div className="mt-7 flex items-end gap-1">
                <span className="text-5xl font-semibold tracking-tight text-white">
                  ${annual ? plan.annual : plan.monthly}
                </span>
                <span className="mb-1.5 text-sm text-neutral-500">/month</span>
              </div>
              <p className="mt-1 text-xs text-neutral-600">
                {annual ? 'billed annually' : 'billed monthly'}
              </p>

              <Link
                href="/auth/signup"
                className={cn(
                  'mt-8 flex w-full items-center justify-center rounded-full py-3 text-sm font-medium transition-colors',
                  plan.highlight
                    ? 'bg-white text-black hover:bg-neutral-200'
                    : 'border border-white/20 text-white hover:bg-white/5'
                )}
              >
                {plan.cta}
              </Link>

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
          ))}
        </div>
      </div>
    </section>
  );
}