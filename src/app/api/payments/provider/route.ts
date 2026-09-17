import { NextRequest, NextResponse } from 'next/server';
import { detectCountry, getPaymentProvider } from '@/lib/geoip';

export async function GET(req: NextRequest) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '';

    // Local development: x-forwarded-for may be ::1 or empty
    const country = ip && ip !== '::1' && ip !== '127.0.0.1'
      ? await detectCountry(ip)
      : 'US';

    const provider = getPaymentProvider(country);

    return NextResponse.json({ provider, country });
  } catch (error) {
    console.error('Provider detection error:', error);
    return NextResponse.json({ provider: 'stripe', country: 'US' });
  }
}