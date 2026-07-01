import { NextResponse } from 'next/server';
import { getTwitchChannel, getTwitchStatus } from '@/lib/twitch';

export async function GET() {
  const status = getTwitchStatus();
  if (!status.connected) return NextResponse.json({ ...status, channel: null });
  try { return NextResponse.json({ ...status, ...(await getTwitchChannel()) }); }
  catch (error) { return NextResponse.json({ ...status, error: error instanceof Error ? error.message : 'Twitch-Status fehlgeschlagen.' }, { status: 502 }); }
}
