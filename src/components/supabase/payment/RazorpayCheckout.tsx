'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

interface RazorpayCheckoutProps {
  amount: number; // in INR
  plan: string;
  onComplete?: (result: { provider: string; status: string }) => void;
  onError?: (error: Error) => void;
}

interface RazorpayHandlerResponse {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
  razorpay_subscription_id?: string;
}

type RazorpayWindow = Window &
  typeof globalThis & {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  };

/**
 * Real Razorpay subscription checkout.
 *
 * Razorpay's client handler fires when the buyer returns from Razorpay. That
 * callback is treated as an untrusted hint: it is posted to
 * /api/payments/razorpay/confirm, which checks the HMAC signature and then
 * re-reads the payment from Razorpay's API before anything is activated. The
 * success state below is only reachable when that server confirms it.
 */
export function RazorpayCheckout({
  amount,
  plan,
  onComplete,
  onError,
}: RazorpayCheckoutProps) {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
      setReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () =>
      onError?.(new Error('Could not load the Razorpay checkout script. Check your connection.'));
    document.body.appendChild(script);
  }, [onError]);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, provider: 'razorpay' }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        window.location.href = '/auth/login?redirectedFrom=/pricing';
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || 'Checkout could not be started.');
      }
      if (data.provider !== 'razorpay' || !data.subscriptionId || !data.keyId) {
        throw new Error('The payment provider did not return a usable checkout.');
      }

      const subscriptionId: string = data.subscriptionId;
      const keyId: string = data.keyId;
      const RazorpayCtor = (window as RazorpayWindow).Razorpay;
      if (!RazorpayCtor) {
        throw new Error('The Razorpay checkout script did not load. Check your connection.');
      }

      const rzp = new RazorpayCtor({
        key: keyId,
        subscription_id: subscriptionId,
        name: 'Krix',
        description: `${plan} plan`,
        prefill: {},
        theme: { color: '#000000' },
        modal: {
          ondismiss: () => setLoading(false),
        },
        handler: async (response: RazorpayHandlerResponse) => {
          try {
            const confirmRes = await fetch('/api/payments/razorpay/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subscriptionId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const confirmBody = await confirmRes.json().catch(() => ({}));
            if (!confirmRes.ok || confirmBody.verified !== true) {
              throw new Error(
                confirmBody.message ||
                  'Razorpay has not confirmed this payment yet. Your plan is unchanged — try again in a moment.'
              );
            }
            onComplete?.({
              provider: 'razorpay',
              status: confirmBody.subscription?.status ?? 'active',
            });
          } catch (err) {
            onError?.(err instanceof Error ? err : new Error('Payment verification failed'));
          } finally {
            setLoading(false);
          }
        },
      });
      rzp.open();
    } catch (err) {
      setLoading(false);
      onError?.(err instanceof Error ? err : new Error('Checkout failed'));
    }
  };

  return (
    <Button onClick={handleCheckout} loading={loading} disabled={!ready} className="w-full">
      {loading ? 'Opening Razorpay…' : `Pay ₹${amount}/month with Razorpay`}
    </Button>
  );
}
