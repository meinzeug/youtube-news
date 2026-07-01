export const dynamic = 'force-dynamic';
import { getSettings } from '@/lib/db';
import { normalizeVideoSettings } from '@/lib/video-settings';
import { flattenSocialSettings, normalizeSocialSettings, socialChannels } from '@/lib/social';
import { buildCronLine, getAutomationSettings, getAutomationStatus, installRootCron, installUserCron, nextRunHint, saveAutomationSettings } from '@/lib/automation';

async function saveSettings(fd: FormData) {
  'use server';
  const { setSettings } = await import('@/lib/db');
  setSettings(Object.fromEntries(fd));
}

async function saveVideoSettings(fd: FormData) {
  'use server';
  const { setSettings } = await import('@/lib/db');
  const { normalizeVideoSettings } = await import('@/lib/video-settings');
  setSettings(normalizeVideoSettings(Object.fromEntries(fd)));
}

async function saveSocialSettings(fd: FormData) {
  'use server';
  const { setSettings } = await import('@/lib/db');
  const { flattenSocialSettings, normalizeSocialSettings } = await import('@/lib/social');
  setSettings(flattenSocialSettings(normalizeSocialSettings(Object.fromEntries(fd))));
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
  const video = normalizeVideoSettings(s);
  const status = await getAutomationStatus();
  const social = normalizeSocialSettings(s);
  return (
    <main className="page">
      <h1>Einstellungen</h1>
      <div className="grid two">
        <form id="settings" action={saveSettings}>
          <h2>Dienste</h2>
          <label>OpenRouter API Key</label>
          <input name="openRouterKey" type="password" defaultValue={s.openRouterKey || ''} />
          <label>Textmodell</label>
          <input name="openRouterTextModel" list="openrouter-models" defaultValue={s.openRouterTextModel || 'openai/gpt-4.1-mini'} />
          <datalist id="openrouter-models">
            {video.aiSuggestedModels.split(',').map((model) => <option key={model.trim()} value={model.trim()} />)}
          </datalist>
          <p className="muted">Tipp: OpenRouter bietet eine OpenAI-kompatible Chat-Completions-API mit Modell-Routing; Modelle können über die OpenRouter Models API aktuell gehalten werden.</p>
          <label>ElevenLabs API Key</label>
          <input name="elevenLabsKey" type="password" defaultValue={s.elevenLabsKey || ''} />
          <label>ElevenLabs Voice ID</label>
          <input name="elevenLabsVoiceId" defaultValue={s.elevenLabsVoiceId || ''} />
          <label>YouTube OAuth Client ID</label>
          <input name="youtubeClientId" defaultValue={s.youtubeClientId || ''} />
          <button>Speichern</button>
        </form>


        <form action={saveVideoSettings}>
          <h2>YouTube-Video Produktion</h2>
          <p className="muted">Detaillierte Vorgaben für jedes generierte Video: Format, Intro/Outro, Bauchbinde, Thumbnail-Stil und spätere Upload-Metadaten.</p>
          <div className="form-split">
            <div>
              <label>Format</label>
              <select name="aspectRatio" defaultValue={video.aspectRatio}>
                <option value="16:9">16:9 YouTube</option>
                <option value="9:16">9:16 Shorts/Reels</option>
                <option value="1:1">1:1 Social Feed</option>
              </select>
            </div>
            <div>
              <label>Auflösung</label>
              <select name="resolution" defaultValue={video.resolution}>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
              </select>
            </div>
          </div>
          <div className="form-split">
            <div><label>Hintergrundfarbe</label><input name="backgroundColor" type="color" defaultValue={video.backgroundColor} /></div>
            <div><label>Akzentfarbe</label><input name="accentColor" type="color" defaultValue={video.accentColor} /></div>
          </div>
          <label>Intro</label>
          <select name="introMode" defaultValue={video.introMode}>
            <option value="generated">Online per SVG/FFmpeg erzeugen</option>
            <option value="asset">Eigenes Video/Bild aus public/ verwenden</option>
            <option value="none">Kein Intro</option>
          </select>
          <label>Intro-Text</label>
          <input name="introText" defaultValue={video.introText} />
          <label>Intro-Dauer in Sekunden</label>
          <input name="introDuration" type="number" min="1" max="30" defaultValue={video.introDuration} />
          <label>Intro-Dateipfad optional</label>
          <input name="introAssetPath" placeholder="/uploads/intro.mp4 oder /generated/mein-intro.svg" defaultValue={video.introAssetPath} />
          <label>Outro</label>
          <select name="outroMode" defaultValue={video.outroMode}>
            <option value="generated">Online per SVG/FFmpeg erzeugen</option>
            <option value="asset">Eigenes Video/Bild aus public/ verwenden</option>
            <option value="none">Kein Outro</option>
          </select>
          <label>Outro-Text</label>
          <input name="outroText" defaultValue={video.outroText} />
          <label>Outro-Dauer in Sekunden</label>
          <input name="outroDuration" type="number" min="1" max="30" defaultValue={video.outroDuration} />
          <label>Outro-Dateipfad optional</label>
          <input name="outroAssetPath" placeholder="/uploads/outro.mp4 oder /generated/mein-outro.svg" defaultValue={video.outroAssetPath} />
          <label className="check"><input name="lowerThirdEnabled" type="checkbox" defaultChecked={video.lowerThirdEnabled} /> Bauchbinde im Hauptvideo anzeigen</label>
          <label>Bauchbinden-Text</label>
          <input name="lowerThirdText" defaultValue={video.lowerThirdText} />
          <label>Thumbnail-Stil</label>
          <select name="thumbnailStyle" defaultValue={video.thumbnailStyle}>
            <option value="editorial">Editorial</option>
            <option value="breaking">Breaking News</option>
            <option value="minimal">Minimal</option>
            <option value="documentary">Dokumentarisch</option>
            <option value="shorts">Shorts mit großer Headline</option>
          </select>
          <div className="ai-panel">
            <h3>KI-Regie mit OpenRouter</h3>
            <p className="muted">Erzeugt per LLM ein strukturiertes Videokonzept mit Skript, Thumbnail-Prompt, YouTube-Titel, Beschreibung, Kapiteln und Sicherheitsnotizen.</p>
            <label className="check"><input name="aiEnhancementEnabled" type="checkbox" defaultChecked={video.aiEnhancementEnabled} /> KI-Video-Regie aktivieren</label>
            <div className="form-split">
              <div><label>Skriptmodus</label><select name="aiScriptMode" defaultValue={video.aiScriptMode}><option value="balanced">Ausgewogen</option><option value="shorts">Shorts</option><option value="deepDive">Deep Dive</option><option value="breaking">Breaking News</option></select></div>
              <div><label>Ton</label><select name="aiTone" defaultValue={video.aiTone}><option value="neutral">Neutral</option><option value="urgent">Dringlich</option><option value="explainer">Erklärend</option><option value="optimistic">Optimistisch</option></select></div>
            </div>
            <label>Zieldauer in Sekunden</label>
            <input name="aiTargetDuration" type="number" min="20" max="600" defaultValue={video.aiTargetDuration} />
            <label>Zielgruppe</label>
            <textarea name="aiAudience" rows={2} defaultValue={video.aiAudience} />
            <label className="check"><input name="aiIncludeHook" type="checkbox" defaultChecked={video.aiIncludeHook} /> Starken Hook am Anfang planen</label>
            <label className="check"><input name="aiIncludeChapters" type="checkbox" defaultChecked={video.aiIncludeChapters} /> Kapitel/Timecodes vorschlagen</label>
            <label>Fakten- und Sicherheitsanweisung</label>
            <textarea name="aiFactCheckPrompt" rows={3} defaultValue={video.aiFactCheckPrompt} />
            <label>Bildprompt-Stil</label>
            <textarea name="aiImagePromptStyle" rows={2} defaultValue={video.aiImagePromptStyle} />
            <label>Empfohlene OpenRouter-Modelle</label>
            <input name="aiSuggestedModels" defaultValue={video.aiSuggestedModels} />
          </div>
          <label>Call-to-Action für Skripte</label>
          <textarea name="callToAction" rows={3} defaultValue={video.callToAction} />
          <h3>YouTube-Metadaten</h3>
          <label>Titel-Vorlage</label>
          <input name="youtubeTitleTemplate" defaultValue={video.youtubeTitleTemplate} />
          <label>Beschreibung-Vorlage</label>
          <textarea name="youtubeDescriptionTemplate" rows={4} defaultValue={video.youtubeDescriptionTemplate} />
          <label>Tags</label>
          <input name="youtubeTags" defaultValue={video.youtubeTags} />
          <div className="form-split">
            <div><label>Sichtbarkeit</label><select name="privacyStatus" defaultValue={video.privacyStatus}><option value="private">Privat</option><option value="unlisted">Nicht gelistet</option><option value="public">Öffentlich</option></select></div>
            <div><label>Sprache</label><input name="language" defaultValue={video.language} /></div>
          </div>
          <button>Video-Einstellungen speichern</button>
        </form>


        <form action={saveSocialSettings}>
          <h2>Social-Media-Verteilung</h2>
          <p className="muted">Nach einem vorbereiteten oder echten YouTube-Upload kann die App automatisch Text und YouTube-Link an aktivierte Kanäle senden. Ohne Webhook wird der Beitrag als vorbereitet protokolliert.</p>
          <label className="check"><input name="socialAutoShareEnabled" type="checkbox" defaultChecked={social.socialAutoShareEnabled} /> Nach YouTube-Upload automatisch teilen</label>
          <label>Standard-Textvorlage</label>
          <textarea name="socialDefaultText" rows={3} defaultValue={social.socialDefaultText} />
          <p className="muted">Variablen: <code>{'{{title}}'}</code>, <code>{'{{summary}}'}</code>, <code>{'{{sourceUrl}}'}</code>, <code>{'{{youtubeUrl}}'}</code>, <code>{'{{channel}}'}</code></p>
          <div className="social-grid">
            {socialChannels.map((channel) => {
              const cfg = social.channels[channel.key];
              return (
                <details className="social-channel" key={channel.key} open={cfg.enabled}>
                  <summary><span>{channel.name}</span><span className={cfg.enabled ? 'badge ok' : 'badge muted-badge'}>{cfg.enabled ? 'aktiv' : 'aus'}</span></summary>
                  <p className="muted">{channel.hint}</p>
                  <label className="check"><input name={`social_${channel.key}_enabled`} type="checkbox" defaultChecked={cfg.enabled} /> Kanal aktivieren</label>
                  <label>Webhook/API-Endpunkt</label>
                  <input name={`social_${channel.key}_webhookUrl`} placeholder={channel.placeholder} defaultValue={cfg.webhookUrl} />
                  <label>Access Token optional</label>
                  <input name={`social_${channel.key}_accessToken`} type="password" defaultValue={cfg.accessToken} />
                  <label>Page-, Account-, Chat- oder Board-ID optional</label>
                  <input name={`social_${channel.key}_pageId`} defaultValue={cfg.pageId} />
                  <label>Textvorlage für {channel.name}</label>
                  <textarea name={`social_${channel.key}_messageTemplate`} rows={3} defaultValue={cfg.messageTemplate} />
                </details>
              );
            })}
          </div>
          <button>Social-Media-Einstellungen speichern</button>
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
