import { NextResponse } from 'next/server';
import { getAIStatus } from '@/lib/ai-provider';

export async function GET() {
  return NextResponse.json({ status: getAIStatus() });
}