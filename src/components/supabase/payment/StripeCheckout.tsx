'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

interface StripeCheckoutProps {
  amount: number;
  plan: string;
  onComplete?: (result: { provider: string; status: string }) => void;
  onError?: (error: Error) => void;
}

/**
 * Real Stripe checkout: the server creates a Stripe Checkout Session and this
 * hands the browser to Stripe's hosted page. Nothing here decides that a payment
 * happened — the subscription is activated by the Stripe webhook after Stripe
 * confirms the charge.
 */
export function StripeCheckout({ amount, plan, onError }: StripeCheckoutProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, provider: 'stripe' }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        window.location.href = '/auth/login?redirectedFrom=/pricing';
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || 'Checkout could not be started.');
      }
      if (!data.checkoutUrl) {
        throw new Error('The payment provider did not return a checkout link.');
      }
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setLoading(false);
      onError?.(err instanceof Error ? err : new Error('Checkout failed'));
    }
  };

  return (
    <Button onClick={handleCheckout} loading={loading} className="w-full">
      {loading ? 'Opening Stripe…' : `Pay $${amount}/month with Stripe`}
    </Button>
  );
}
