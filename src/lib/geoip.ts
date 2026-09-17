export async function detectCountry(ip: string): Promise<string> {
  try {
    // Using MaxMind GeoIP2
    const response = await fetch(
      `https://geoip.maxmind.com/geoip/v2.1/city/${ip}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${process.env.MAXMIND_ACCOUNT_ID}:${process.env.MAXMIND_LICENSE_KEY}`
          ).toString('base64')}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GeoIP request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.country.iso_code; // Returns country code like 'IN', 'US', 'GB'
  } catch (error) {
    console.error('Geo-IP error:', error);
    return 'US'; // Default to US
  }
}

export function getPaymentProvider(countryCode: string): 'razorpay' | 'stripe' {
  const razorpayCountries = ['IN', 'BD', 'LK', 'PK'];
  return razorpayCountries.includes(countryCode) ? 'razorpay' : 'stripe';
}