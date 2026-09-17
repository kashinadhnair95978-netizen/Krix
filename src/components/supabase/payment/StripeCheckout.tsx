'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

interface StripeCheckoutProps {
  amount: number;
  plan: string;
  onComplete?: (result: any) => void;
  onError?: (error: Error) => void;
}

export function StripeCheckout({
  amount,
  plan,
  onComplete,
  onError,
}: StripeCheckoutProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/payments/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Checkout failed');
      }

      if (data.clientSecret) {
        // Production: render Stripe Elements with this client secret
        // to complete 3DS/auth flows. For the hosted flow, redirect:
        const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (publishable && confirmScriptLoaded()) {
          // Compact hosted flow via a redirect URL is handled below
          window.location.href = `/checkout/stripe?clientSecret=${data.clientSecret}`;
          return;
        }
      }

      onComplete?.({ provider: 'stripe', ...data });
    } catch (err: any) {
      onError?.(err instanceof Error ? err : new Error(err?.message || 'Checkout failed'));
    } finally {
      setLoading(false);
    }
  };

  const confirmScriptLoaded = () => typeof window !== 'undefined';

  return (
    <Button onClick={handleCheckout} loading={loading} className="w-full">
      {loading ? 'Redirecting to Stripe...' : `Pay $${amount}/month`}
    </Button>
  );
}