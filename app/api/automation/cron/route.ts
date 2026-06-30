import { NextRequest, NextResponse } from 'next/server';
import { installRootCron, installUserCron, saveAutomationSettings } from '@/lib/automation';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  saveAutomationSettings(body);
  try {
    const message = body.scope === 'root' ? await installRootCron(body.rootPassword) : await installUserCron();
    return NextResponse.json({ ok: true, message });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Cron konnte nicht installiert werden' }, { status: 500 });
  }
}
