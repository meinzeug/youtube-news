import { NextRequest, NextResponse } from 'next/server'; import { getSettings,setSettings } from '@/lib/db';
const secretKeys = new Set(['openRouterKey','elevenLabsKey','youtubeClientSecret','youtubeAccessToken','youtubeRefreshToken','youtubeOAuthState']);
function redact(settings: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, secretKeys.has(key) && value ? '*** gespeichert ***' : value]));
}
export async function GET(){return NextResponse.json(redact(getSettings() as Record<string, unknown>))}
export async function POST(req:NextRequest){setSettings(await req.json()); return NextResponse.json({ok:true})}
