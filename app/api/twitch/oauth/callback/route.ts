import { NextResponse } from 'next/server';
import { finishTwitchOAuth } from '@/lib/twitch';
import { setSettings } from '@/lib/db';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  try {
    if (error) throw new Error(error);
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    if (!code) throw new Error('Twitch hat keinen Autorisierungscode geliefert.');
    await finishTwitchOAuth(code, state);
    return NextResponse.redirect(new URL('/settings#twitch-connected', request.url));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Twitch OAuth fehlgeschlagen.';
    setSettings({ twitchLastConnectionError: message });
    return NextResponse.redirect(new URL(`/settings?twitchError=${encodeURIComponent(message)}`, request.url));
  }
}
