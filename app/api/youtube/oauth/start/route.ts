import { NextRequest, NextResponse } from 'next/server';
import { getSettings, setSettings } from '@/lib/db';
import { createYoutubeAuthorizationUrl, getYoutubeRedirectUri, normalizeYoutubeSettings } from '@/lib/youtube';

export async function GET(req: NextRequest) {
  try {
    const settings = normalizeYoutubeSettings(getSettings() as Record<string, unknown>);
    const redirectUri = getYoutubeRedirectUri(req.url, settings);
    const url = createYoutubeAuthorizationUrl(settings, redirectUri);
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTube OAuth konnte nicht gestartet werden.';
    setSettings({ youtubeLastConnectionError: message });
    const redirect = new URL('/settings', req.url);
    redirect.searchParams.set('youtube', 'error');
    return NextResponse.redirect(redirect);
  }
}
