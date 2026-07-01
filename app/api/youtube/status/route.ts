import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';
import { getYoutubeConnectionStatus } from '@/lib/youtube';

export async function GET() {
  return NextResponse.json(getYoutubeConnectionStatus(getSettings() as Record<string, unknown>));
}
