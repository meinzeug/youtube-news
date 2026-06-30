export const dynamic = 'force-dynamic';
import { getSettings } from '@/lib/db';
import { buildCronLine, getAutomationSettings, getAutomationStatus, installRootCron, installUserCron, nextRunHint, saveAutomationSettings } from '@/lib/automation';

async function saveSettings(fd: FormData) {
  'use server';
  const { setSettings } = await import('@/lib/db');
  setSettings(Object.fromEntries(fd));
}

async function saveAutomation(fd: FormData) {
  'use server';
  saveAutomationSettings(Object.fromEntries(fd));
}

async function applyCron(fd: FormData) {
  'use server';
  saveAutomationSettings(Object.fromEntries(fd));
  if (fd.get('scope') === 'root') await installRootCron(String(fd.get('rootPassword') || ''));
  else await installUserCron();
}

export default async function Settings() {
  const s = getSettings() as any;
  const automation = getAutomationSettings();
  const status = await getAutomationStatus();
  return (
    <main className="page">
      <h1>Einstellungen</h1>
      <div className="grid two">
        <form id="settings" action={saveSettings}>
          <h2>Dienste</h2>
          <label>OpenRouter API Key</label>
          <input name="openRouterKey" type="password" defaultValue={s.openRouterKey || ''} />
          <label>Textmodell</label>
          <input name="openRouterTextModel" defaultValue={s.openRouterTextModel || 'openai/gpt-4.1-mini'} />
          <label>ElevenLabs API Key</label>
          <input name="elevenLabsKey" type="password" defaultValue={s.elevenLabsKey || ''} />
          <label>ElevenLabs Voice ID</label>
          <input name="elevenLabsVoiceId" defaultValue={s.elevenLabsVoiceId || ''} />
          <label>YouTube OAuth Client ID</label>
          <input name="youtubeClientId" defaultValue={s.youtubeClientId || ''} />
          <button>Speichern</button>
        </form>

        <form action={applyCron}>
          <h2>Web-Automatisierung & Cron</h2>
          <p className="muted">Hier kann der laufende Server die Automatisierung selbst konfigurieren. Standard ist die sichere Benutzer-Crontab; Root wird nur bei Bedarf per sudo verwendet. Das Passwort wird nur an sudo übergeben und nicht gespeichert.</p>
          <div className="automation-health">
            <span className={status.enabled ? 'badge ok' : 'badge muted-badge'}>{status.enabled ? 'Automation aktiv' : 'Automation aus'}</span>
            <span className={status.userCrontabActive ? 'badge ok' : 'badge muted-badge'}>Benutzer-Cron {status.userCrontabActive ? 'aktiv' : 'inaktiv'}</span>
            <span className={status.rootCrontabActive ? 'badge ok' : 'badge muted-badge'}>Root-Cron {status.rootCrontabActive ? 'aktiv' : 'inaktiv'}</span>
          </div>
          <label className="check"><input name="enabled" type="checkbox" defaultChecked={automation.enabled} /> Automatisierung aktiv</label>
          <label className="check"><input name="crawl" type="checkbox" defaultChecked={automation.crawl} /> Vor jedem Lauf Quellen crawlen</label>
          <label>Intervall in Minuten</label>
          <input name="intervalMinutes" type="number" min="1" max="1440" defaultValue={automation.intervalMinutes} />
          <label>Max. Artikel pro Lauf</label>
          <input name="maxArticles" type="number" min="1" max="20" defaultValue={automation.maxArticles} />
          <label>Öffentliche Server-URL</label>
          <input name="baseUrl" defaultValue={automation.baseUrl} />
          <label>Cron-Rechte</label>
          <select name="scope" defaultValue={automation.cronScope}>
            <option value="user">Benutzer-Crontab (empfohlen)</option>
            <option value="root">Root-Crontab per sudo</option>
          </select>
          <label>Root-Passwort nur für diesen Vorgang</label>
          <input name="rootPassword" type="password" placeholder="Nur nötig für Root-Crontab" autoComplete="off" />
          <p className="muted">Server läuft als <strong>{status.effectiveUser}</strong>. Passwortloses sudo: {status.sudoAvailable ? 'verfügbar' : 'nicht verfügbar'}.</p>
          <button>Cron über Weboberfläche anwenden</button>
          <button formAction={saveAutomation}>Nur Einstellungen speichern</button>
          <div className="card preview">
            <strong>Geplanter Cron-Eintrag</strong>
            <code>{buildCronLine(automation)}</code>
            <p className="muted">{nextRunHint(automation)}</p>
            <p className="muted">Letzter Status: {status.cronLastResult || 'Noch nicht angewendet'}</p>
            {status.cronLastError ? <p className="error">Letzter Fehler: {status.cronLastError}</p> : null}
            <p className="muted">Live-Status ist auch als JSON unter <code>/api/automation/cron</code> abrufbar.</p>
          </div>
        </form>
      </div>
    </main>
  );
}
