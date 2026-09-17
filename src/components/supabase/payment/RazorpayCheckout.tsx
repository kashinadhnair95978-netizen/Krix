'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';

interface RazorpayCheckoutProps {
  amount: number; // in INR
  plan: string;
  onComplete?: (result: any) => void;
  onError?: (error: Error) => void;
}

export function RazorpayCheckout({
  amount,
  plan,
  onComplete,
  onError,
}: RazorpayCheckoutProps) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Load the Razorpay checkout script
    if (!document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();

      if (data.provider !== 'razorpay') {
        throw new Error('Unexpected provider');
      }

      const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      if (!keyId) {
        throw new Error('Razorpay key not configured');
      }

      const options = {
        key: keyId,
        subscription_id: data.subscriptionId,
        name: 'Krix',
        description: `${plan} plan`,
        prefill: {},
        theme: { color: '#000000' },
        handler: (response: any) => {
          onComplete?.({ provider: 'razorpay', ...response });
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      onError?.(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleCheckout} loading={loading} className="w-full">
      {loading ? 'Opening Razorpay...' : `Pay ₹${amount}/month`}
    </Button>
  );
}