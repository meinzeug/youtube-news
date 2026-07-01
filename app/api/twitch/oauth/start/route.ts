import { NextResponse } from 'next/server';
import { startTwitchOAuth } from '@/lib/twitch';

export function GET(request: Request) {
  try { return NextResponse.redirect(startTwitchOAuth()); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Twitch-Verbindung konnte nicht gestartet werden.';
    return NextResponse.redirect(new URL(`/settings?twitchError=${encodeURIComponent(message)}`, request.url));
  }
}
