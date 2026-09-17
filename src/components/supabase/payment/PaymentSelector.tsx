'use client';

import { useEffect, useState } from 'react';
import { StripeCheckout } from './StripeCheckout';
import { RazorpayCheckout } from './RazorpayCheckout';

interface PaymentSelectorProps {
  plan: string;
  amountUsd: number;
  amountInr: number;
  onComplete?: (result: any) => void;
}

export function PaymentSelector({
  plan,
  amountUsd,
  amountInr,
  onComplete,
}: PaymentSelectorProps) {
  const [provider, setProvider] = useState<'auto' | 'stripe' | 'razorpay'>(
    'auto'
  );
  const [resolvedProvider, setResolvedProvider] = useState<
    'stripe' | 'razorpay' | null
  >(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (provider !== 'auto') return;
    const detect = async () => {
      try {
        const res = await fetch('/api/payments/provider');
        const data = await res.json();
        setResolvedProvider(data.provider);
      } catch {
        setResolvedProvider('stripe');
      }
    };
    detect();
  }, [provider]);

  const handleComplete = (result: any) => {
    onComplete?.(result);
  };

  const effectiveProvider =
    provider === 'auto' ? resolvedProvider : provider;

  return (
    <div className="space-y-4">
      {!effectiveProvider && (
        <div className="text-center py-4 text-sm text-gray-500">
          Detecting payment method for your region...
        </div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {effectiveProvider === 'stripe' && (
        <StripeCheckout
          amount={amountUsd}
          plan={plan}
          onComplete={handleComplete}
          onError={(e) => setError(e.message)}
        />
      )}

      {effectiveProvider === 'razorpay' && (
        <RazorpayCheckout
          amount={amountInr}
          plan={plan}
          onComplete={handleComplete}
          onError={(e) => setError(e.message)}
        />
      )}

      <div className="text-center">
        <button
          onClick={() =>
            setProvider(provider === 'auto' ? 'stripe' : 'auto')
          }
          className="text-sm text-gray-500 hover:underline"
        >
          {provider === 'auto'
            ? 'Use a different payment method'
            : 'Auto-detect payment method'}
        </button>
      </div>
    </div>
  );
}