import { NextRequest, NextResponse } from 'next/server';
import { setSettings } from '@/lib/db';
import { completeYoutubeOAuth } from '@/lib/youtube';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const redirect = new URL('/settings', req.url);
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    setSettings({ youtubeLastConnectionError: oauthError });
    redirect.searchParams.set('youtube', 'error');
    return NextResponse.redirect(redirect);
  }

  try {
    await completeYoutubeOAuth(url.searchParams.get('code') || '', url.searchParams.get('state'), req.url);
    redirect.searchParams.set('youtube', 'connected');
    return NextResponse.redirect(redirect);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTube OAuth Callback fehlgeschlagen.';
    setSettings({ youtubeLastConnectionError: message });
    redirect.searchParams.set('youtube', 'error');
    return NextResponse.redirect(redirect);
  }
}
