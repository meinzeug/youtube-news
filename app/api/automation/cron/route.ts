import { NextRequest, NextResponse } from 'next/server';
import { getAutomationStatus, installRootCron, installUserCron, saveAutomationSettings } from '@/lib/automation';
import { setSettings } from '@/lib/db';

export async function GET() {
  return NextResponse.json(await getAutomationStatus());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  saveAutomationSettings(body);
  try {
    const message = body.scope === 'root' ? await installRootCron(body.rootPassword) : await installUserCron();
    return NextResponse.json({ ok: true, message, status: await getAutomationStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cron konnte nicht installiert werden';
    setSettings({ cronLastError: message, cronLastResult: '' });
    return NextResponse.json({ ok: false, message, status: await getAutomationStatus() }, { status: 500 });
  }
}
