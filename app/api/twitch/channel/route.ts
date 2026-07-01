import { NextRequest, NextResponse } from 'next/server';
import { createTwitchMarker, updateTwitchChannel } from '@/lib/twitch';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    await updateTwitchChannel({ title: String(body.title || ''), gameId: body.gameId ? String(body.gameId) : undefined, tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Twitch-Update fehlgeschlagen.' }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json({ ok: true, marker: await createTwitchMarker(String(body.description || 'Redaktioneller Marker')) });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Twitch-Marker fehlgeschlagen.' }, { status: 400 }); }
}
