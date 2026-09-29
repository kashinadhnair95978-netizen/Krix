import { NextResponse } from 'next/server';
import { getAIStatusAsync } from '@/lib/ai-provider';

export const runtime = 'nodejs';

/**
 * Provider/model health, including whether the configured model is one the
 * provider actually serves. A key without a reachable model reports
 * `configured: false` with the variable to fix.
 */
export async function GET() {
  return NextResponse.json({ status: await getAIStatusAsync() });
}
