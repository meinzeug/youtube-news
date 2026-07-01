export const dynamic = 'force-dynamic';
import { getSettings } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeVideoSettings } from '@/lib/video-settings';
import { flattenSocialSettings, normalizeSocialSettings, socialChannels } from '@/lib/social';
import { buildCronLine, getAutomationSettings, getAutomationStatus, installRootCron, installUserCron, nextRunHint, saveAutomationSettings } from '@/lib/automation';
import { getYoutubeConnectionStatus, normalizeYoutubeSettings, YOUTUBE_READONLY_SCOPE, YOUTUBE_UPLOAD_SCOPE } from '@/lib/youtube';
import { getTwitchStatus, normalizeTwitchSettings, TWITCH_SCOPES } from '@/lib/twitch';
import { MODEL_ROUTES } from '@/lib/ai';

async function persistServiceSettings(fd: FormData) {
  const { getSettings, setSettings } = await import('@/lib/db');
  const current = getSettings() as Record<string, unknown>;
  const oldYoutubeClientId = String(current.youtubeClientId || '');
  const oldYoutubeClientSecret = String(current.youtubeClientSecret || '');
  const oldYoutubeRedirectUri = String(current.youtubeRedirectUri || '');
  const nextYoutubeClientId = formText(fd, 'youtubeClientId');
  const nextYoutubeClientSecret = formSecret(fd, 'youtubeClientSecret', oldYoutubeClientSecret);
  const nextYoutubeRedirectUri = formText(fd, 'youtubeRedirectUri');
  const youtubeCredentialsChanged =
    oldYoutubeClientId !== nextYoutubeClientId ||
    oldYoutubeClientSecret !== nextYoutubeClientSecret ||
    oldYoutubeRedirectUri !== nextYoutubeRedirectUri;
  const oldTwitchClientId = String(current.twitchClientId || '');
  const oldTwitchClientSecret = String(current.twitchClientSecret || '');
  const oldTwitchRedirectUri = String(current.twitchRedirectUri || '');
  const nextTwitchClientId = formText(fd, 'twitchClientId');
  const nextTwitchClientSecret = formSecret(fd, 'twitchClientSecret', oldTwitchClientSecret);
  const nextTwitchRedirectUri = formText(fd, 'twitchRedirectUri');
  const twitchCredentialsChanged = oldTwitchClientId !== nextTwitchClientId || oldTwitchClientSecret !== nextTwitchClientSecret || oldTwitchRedirectUri !== nextTwitchRedirectUri;

  const next: Record<string, unknown> = {
    openRouterKey: formSecret(fd, 'openRouterKey', String(current.openRouterKey || '')),
    openRouterTextModel: formText(fd, 'openRouterTextModel') || 'openai/gpt-4.1-mini',
    elevenLabsKey: formSecret(fd, 'elevenLabsKey', String(current.elevenLabsKey || '')),
    elevenLabsVoiceId: formText(fd, 'elevenLabsVoiceId'),
    elevenLabsModelId: formText(fd, 'elevenLabsModelId') || 'eleven_multilingual_v2',
    localTtsVoice: formText(fd, 'localTtsVoice') || 'de',
    localTtsSpeed: Math.max(80, Math.min(300, Number(fd.get('localTtsSpeed') || 155))),
    youtubeClientId: nextYoutubeClientId,
    youtubeClientSecret: nextYoutubeClientSecret,
    youtubeRedirectUri: nextYoutubeRedirectUri,
    youtubeUploadMode: fd.get('youtubeUploadMode') === 'api' ? 'api' : 'prepared',
    youtubeCategoryId: formText(fd, 'youtubeCategoryId') || '25',
    youtubeContainsSyntheticMedia: fd.has('youtubeContainsSyntheticMedia'),
    youtubeSelfDeclaredMadeForKids: fd.has('youtubeSelfDeclaredMadeForKids'),
    twitchClientId: nextTwitchClientId,
    twitchClientSecret: nextTwitchClientSecret,
    twitchRedirectUri: nextTwitchRedirectUri,
    aiCompanyEnabled: fd.has('aiCompanyEnabled'),
    aiMonthlyBudgetUsd: Math.max(0.1, Number(fd.get('aiMonthlyBudgetUsd') || 15)),
    aiPerRequestLimitUsd: Math.max(0.001, Number(fd.get('aiPerRequestLimitUsd') || 0.08)),
    aiApprovalThresholdUsd: Math.max(0.001, Number(fd.get('aiApprovalThresholdUsd') || 0.04)),
    brandName: formText(fd, 'brandName') || 'YouTube News',
    brandMission: formText(fd, 'brandMission'),
    brandAudience: formText(fd, 'brandAudience'),
  };
  for (const route of MODEL_ROUTES) next[`aiModel_${route.scenario}`] = formText(fd, `aiModel_${route.scenario}`) || route.model;

  if (youtubeCredentialsChanged) {
    Object.assign(next, {
      youtubeAccessToken: '',
      youtubeRefreshToken: '',
      youtubeTokenExpiresAt: '',
      youtubeGrantedScopes: '',
      youtubeChannelId: '',
      youtubeChannelTitle: '',
      youtubeChannelUrl: '',
      youtubeOAuthState: '',
      youtubeConnectedAt: '',
    });
  }
  if (twitchCredentialsChanged) Object.assign(next, { twitchAccessToken: '', twitchRefreshToken: '', twitchTokenExpiresAt: '', twitchBroadcasterId: '', twitchBroadcasterLogin: '', twitchBroadcasterName: '', twitchGrantedScopes: '', twitchOAuthState: '', twitchConnectedAt: '' });

  setSettings(next);
}

async function saveServiceSettings(fd: FormData) {
  'use server';
  await persistServiceSettings(fd);
  revalidatePath('/settings');
}

async function connectYoutube(fd: FormData) {
  'use server';
  await persistServiceSettings(fd);
  revalidatePath('/settings');
  redirect('/api/youtube/oauth/start');
}

async function refreshYoutubeConnection(fd: FormData) {
  'use server';
  await persistServiceSettings(fd);
  const { setSettings } = await import('@/lib/db');
  const { verifyYoutubeConnection } = await import('@/lib/youtube');
  try {
    await verifyYoutubeConnection();
  } catch (error) {
    setSettings({ youtubeLastConnectionError: error instanceof Error ? error.message : 'YouTube-Verbindung konnte nicht geprüft werden.' });
  }
  revalidatePath('/settings');
}

async function disconnectYoutubeAction() {
  'use server';
  const { disconnectYoutube } = await import('@/lib/youtube');
  disconnectYoutube();
  revalidatePath('/settings');
}

async function connectTwitch(fd: FormData) {
  'use server';
  await persistServiceSettings(fd);
  revalidatePath('/settings');
  redirect('/api/twitch/oauth/start');
}

async function refreshTwitchConnection(fd: FormData) {
  'use server';
  await persistServiceSettings(fd);
  const { setSettings } = await import('@/lib/db');
  const { verifyTwitchConnection } = await import('@/lib/twitch');
  try { await verifyTwitchConnection(); }
  catch (error) { setSettings({ twitchLastConnectionError: error instanceof Error ? error.message : 'Twitch-Verbindung konnte nicht geprüft werden.' }); }
  revalidatePath('/settings');
}

async function disconnectTwitchAction() {
  'use server';
  const { disconnectTwitch } = await import('@/lib/twitch');
  disconnectTwitch();
  revalidatePath('/settings');
}

async function saveVideoSettings(fd: FormData) {
  'use server';
  const { setSettings } = await import('@/lib/db');
  const { normalizeVideoSettings } = await import('@/lib/video-settings');
  const input = Object.fromEntries(fd);
  setSettings(normalizeVideoSettings({
    ...input,
    lowerThirdEnabled: fd.has('lowerThirdEnabled'),
    useSourceImages: fd.has('useSourceImages'),
    aiEnhancementEnabled: fd.has('aiEnhancementEnabled'),
    aiIncludeHook: fd.has('aiIncludeHook'),
    aiIncludeChapters: fd.has('aiIncludeChapters'),
  }));
  revalidatePath('/settings');
}

async function saveSocialSettings(fd: FormData) {
  'use server';
  const { setSettings } = await import('@/lib/db');
  const { flattenSocialSettings, normalizeSocialSettings } = await import('@/lib/social');
  setSettings(flattenSocialSettings(normalizeSocialSettings(Object.fromEntries(fd))));
  revalidatePath('/settings');
}

async function saveAutomation(fd: FormData) {
  'use server';
  saveAutomationSettings(Object.fromEntries(fd));
  revalidatePath('/settings');
}

async function applyCron(fd: FormData) {
  'use server';
  saveAutomationSettings(Object.fromEntries(fd));
  if (fd.get('scope') === 'root') await installRootCron(String(fd.get('rootPassword') || ''));
  else await installUserCron();
  revalidatePath('/settings');
}

function formText(fd: FormData, key: string) {
  const value = fd.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function formSecret(fd: FormData, key: string, existing: string) {
  const value = formText(fd, key);
  return value || existing;
}

export default async function Settings() {
  const s = getSettings() as any;
  const automation = getAutomationSettings();
  const video = normalizeVideoSettings(s);
  const status = await getAutomationStatus();
  const social = normalizeSocialSettings(s);
  const youtube = normalizeYoutubeSettings(s);
  const youtubeStatus = getYoutubeConnectionStatus(s);
  const twitch = normalizeTwitchSettings(s);
  const twitchStatus = getTwitchStatus(s);
  const suggestedYoutubeRedirectUri = youtube.redirectUri || `${automation.baseUrl.replace(/\/$/, '')}/api/youtube/oauth/callback`;
  const suggestedTwitchRedirectUri = twitch.redirectUri || `${automation.baseUrl.replace(/\/$/, '')}/api/twitch/oauth/callback`;
  return (
    <main className="page">
      <h1>Einstellungen</h1>
      <div className="grid two">
        <form id="settings" action={saveServiceSettings}>
          <h2>Dienste</h2>
          <p className="muted">API-Zugänge für KI, Sprache, YouTube und Twitch. Secret-Felder leer lassen, um gespeicherte Werte beizubehalten.</p>
          <div className="service-tabs">
            <input id="service-openrouter" type="radio" name="serviceTab" defaultChecked />
            <input id="service-elevenlabs" type="radio" name="serviceTab" />
            <input id="service-youtube" type="radio" name="serviceTab" />
            <input id="service-twitch" type="radio" name="serviceTab" />

            <div className="service-tab-list" aria-label="Dienste">
              <label className="service-tab-label" htmlFor="service-openrouter">OpenRouter</label>
              <label className="service-tab-label" htmlFor="service-elevenlabs">ElevenLabs</label>
              <label className="service-tab-label" htmlFor="service-youtube">YouTube</label>
              <label className="service-tab-label" htmlFor="service-twitch">Twitch</label>
            </div>

            <section className="service-panel openrouter-panel">
              <h3>OpenRouter</h3>
              <label>OpenRouter API Key</label>
              <input name="openRouterKey" type="password" placeholder={s.openRouterKey ? 'gespeichert – leer lassen zum Behalten' : ''} autoComplete="off" />
              <label>Textmodell</label>
              <input name="openRouterTextModel" list="openrouter-models" defaultValue={s.openRouterTextModel || 'openai/gpt-4.1-mini'} />
              <datalist id="openrouter-models">
                {video.aiSuggestedModels.split(',').map((model) => <option key={model.trim()} value={model.trim()} />)}
              </datalist>
              <p className="muted">OpenRouter wird für KI-Regie, Skript, Titel, Beschreibung, Kapitel und Thumbnail-Prompt verwendet.</p>
              <div id="ai-company" className="oauth-checklist">
                <strong>KI-Unternehmen & Kostenbremse</strong>
                <label className="check"><input name="aiCompanyEnabled" type="checkbox" defaultChecked={s.aiCompanyEnabled !== false} /> KI-Mitarbeiter aktiv</label>
                <div className="form-split"><div><label>Monatsbudget (USD)</label><input name="aiMonthlyBudgetUsd" type="number" min="0.1" step="0.1" defaultValue={s.aiMonthlyBudgetUsd ?? 15} /></div><div><label>Max. pro Anfrage (USD)</label><input name="aiPerRequestLimitUsd" type="number" min="0.001" step="0.001" defaultValue={s.aiPerRequestLimitUsd ?? 0.08} /></div></div>
                <label>Freigabeschwelle (USD)</label><input name="aiApprovalThresholdUsd" type="number" min="0.001" step="0.001" defaultValue={s.aiApprovalThresholdUsd ?? 0.04} />
                <label>Markenname</label><input name="brandName" defaultValue={s.brandName || 'YouTube News'} />
                <label>Mission</label><textarea name="brandMission" rows={3} defaultValue={s.brandMission || 'Unabhängige Nachrichten verständlich einordnen und als Video, Livestream und Artikel veröffentlichen.'} />
                <label>Zielgruppe</label><textarea name="brandAudience" rows={2} defaultValue={s.brandAudience || 'Deutschsprachige Zuschauer, die schnelle Meldungen und nachvollziehbare Einordnung suchen.'} />
              </div>
              <h4>Modelle nach Aufgabe</h4>
              {MODEL_ROUTES.map((route) => <div className="model-setting" key={route.scenario}><label>{route.label}</label><input name={`aiModel_${route.scenario}`} defaultValue={s[`aiModel_${route.scenario}`] || route.model} /><small>{route.purpose} · Richtwert ${route.inputPerMillion}/M Input, ${route.outputPerMillion}/M Output</small></div>)}
            </section>

            <section className="service-panel elevenlabs-panel">
              <h3>ElevenLabs</h3>
              <label>ElevenLabs API Key</label>
              <input name="elevenLabsKey" type="password" placeholder={s.elevenLabsKey ? 'gespeichert – leer lassen zum Behalten' : ''} autoComplete="off" />
              <label>Voice ID</label>
              <input name="elevenLabsVoiceId" placeholder="z.B. 21m00Tcm4TlvDq8ikWAM" defaultValue={s.elevenLabsVoiceId || ''} />
              <label>Model ID</label>
              <input name="elevenLabsModelId" defaultValue={s.elevenLabsModelId || 'eleven_multilingual_v2'} />
              <h4>Lokale Sprachausgabe</h4>
              <div className="form-split">
                <div><label>Lokale Stimme</label><input name="localTtsVoice" defaultValue={s.localTtsVoice || 'de'} /></div>
                <div><label>Sprechtempo (Wörter/Minute)</label><input name="localTtsSpeed" type="number" min="80" max="300" defaultValue={s.localTtsSpeed || 155} /></div>
              </div>
              <p className="muted">Ohne ElevenLabs-Key oder bei einem API-Fehler erzeugt die mitgelieferte eSpeak-NG-Engine lokal echten deutschen Sprechertext. Es wird kein Cloud-Dienst benötigt.</p>
            </section>

            <section className="service-panel youtube-panel">
              <div className="service-panel-header">
                <h3>YouTube</h3>
                <a className="help-icon" href="#youtube-oauth-help" aria-label="YouTube-Verbindungsanleitung öffnen">?</a>
              </div>
              <div id="youtube-oauth-help" className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="youtube-oauth-help-title">
                <a className="modal-backdrop" href="#settings" aria-label="Anleitung schließen" />
                <div className="modal-card">
                  <div className="modal-header">
                    <div>
                      <p className="eyebrow">YouTube OAuth Setup</p>
                      <h2 id="youtube-oauth-help-title">Schritt-für-Schritt Anleitung</h2>
                    </div>
                    <a className="modal-close" href="#settings" aria-label="Anleitung schließen">×</a>
                  </div>
                  <ol className="step-list">
                    <li>
                      <strong>Google-Cloud-Projekt öffnen oder erstellen.</strong>
                      <p>Öffne die <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>, wähle oben links das richtige Projekt oder erstelle ein neues Projekt über <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Neues Projekt</a>.</p>
                    </li>
                    <li>
                      <strong>YouTube Data API v3 aktivieren.</strong>
                      <p>Öffne direkt die <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">YouTube Data API v3</a> und klicke auf <em>Enable/Aktivieren</em>.</p>
                    </li>
                    <li>
                      <strong>OAuth-Zustimmungsbildschirm konfigurieren.</strong>
                      <p>Gehe zu <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noreferrer">APIs & Services → OAuth consent screen</a>. Für ein privates Gmail-Konto normalerweise <em>External</em> wählen, App-Name und Support-Mail eintragen. Solange die App im Testmodus ist, unter <em>Test users</em> genau das Google-Konto hinzufügen, dessen YouTube-Kanal verbunden werden soll.</p>
                    </li>
                    <li>
                      <strong>Scopes eintragen.</strong>
                      <p>Füge in der OAuth-/Data-Access-Konfiguration diese Scopes hinzu:</p>
                      <code className="copy-value">{YOUTUBE_UPLOAD_SCOPE}</code>
                      <code className="copy-value">{YOUTUBE_READONLY_SCOPE}</code>
                    </li>
                    <li>
                      <strong>OAuth Client erstellen.</strong>
                      <p>Öffne <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">APIs & Services → Credentials</a>, klicke <em>Create credentials → OAuth client ID</em> und wähle als Anwendungstyp <em>Web application</em>.</p>
                    </li>
                    <li>
                      <strong>Redirect URI exakt hinterlegen.</strong>
                      <p>Unter <em>Authorized redirect URIs</em> exakt diese URI eintragen:</p>
                      <code className="copy-value">{suggestedYoutubeRedirectUri}</code>
                      <p>Wichtig: Protokoll, Domain/IP, Port und Pfad müssen exakt gleich sein. Ein häufiger Fehler ist <code>redirect_uri_mismatch</code>.</p>
                    </li>
                    <li>
                      <strong>Client ID und Client Secret kopieren.</strong>
                      <p>Nach dem Erstellen die Werte aus Google in die Felder <em>YouTube OAuth Client ID</em> und <em>YouTube OAuth Client Secret</em> in dieser App eintragen.</p>
                    </li>
                    <li>
                      <strong>In dieser App verbinden.</strong>
                      <p>Upload-Modus auf <em>Echt per YouTube Data API hochladen</em> stellen, dann <em>Speichern und YouTube verbinden</em> klicken. Google fragt nach Zustimmung und leitet danach zurück in diese App.</p>
                    </li>
                    <li>
                      <strong>Verbindung prüfen.</strong>
                      <p>Wenn hier danach „YouTube verbunden“ und der Kanalname angezeigt wird, ist die Verbindung aktiv. Bei Fehlern zuerst Redirect URI, Testnutzer, aktivierte API und Scopes prüfen.</p>
                    </li>
                  </ol>
                  <p className="muted">Offizielle Referenzen: <a href="https://developers.google.com/identity/protocols/oauth2/web-server" target="_blank" rel="noreferrer">Google OAuth Web Server Flow</a> und <a href="https://developers.google.com/youtube/v3/guides/uploading_a_video" target="_blank" rel="noreferrer">YouTube Upload Guide</a>.</p>
                </div>
              </div>
              <div className="service-status">
                <span className={youtubeStatus.connected ? 'badge ok' : 'badge muted-badge'}>{youtubeStatus.connected ? 'YouTube verbunden' : 'YouTube nicht verbunden'}</span>
                <span className={youtubeStatus.canUpload ? 'badge ok' : 'badge muted-badge'}>{youtubeStatus.canUpload ? 'API-Upload aktiv' : 'Upload nur vorbereitet'}</span>
              </div>
              {youtubeStatus.channelId ? (
                <p className="muted">Kanal: <a href={youtubeStatus.channelUrl} target="_blank" rel="noreferrer">{youtubeStatus.channelTitle || youtubeStatus.channelId}</a></p>
              ) : null}
              {youtubeStatus.lastConnectionError ? <p className="error">YouTube-Verbindung: {youtubeStatus.lastConnectionError}</p> : null}
              {youtubeStatus.lastUploadError ? <p className="error">Letzter Upload: {youtubeStatus.lastUploadError}</p> : null}
              <label>YouTube OAuth Client ID</label>
              <input name="youtubeClientId" defaultValue={youtube.clientId} autoComplete="off" />
              <label>YouTube OAuth Client Secret</label>
              <input name="youtubeClientSecret" type="password" placeholder={youtube.clientSecret ? 'gespeichert – leer lassen zum Behalten' : ''} autoComplete="off" />
              <label>Authorized Redirect URI</label>
              <input name="youtubeRedirectUri" defaultValue={suggestedYoutubeRedirectUri} />
              <p className="muted">Diese URI muss exakt in Google Cloud beim OAuth-Web-Client hinterlegt sein.</p>
              <div className="form-split">
                <div>
                  <label>Upload-Modus</label>
                  <select name="youtubeUploadMode" defaultValue={youtube.uploadMode}>
                    <option value="prepared">Nur Upload vorbereiten</option>
                    <option value="api">Echt per YouTube Data API hochladen</option>
                  </select>
                </div>
                <div>
                  <label>YouTube Kategorie-ID</label>
                  <input name="youtubeCategoryId" defaultValue={youtube.categoryId} />
                </div>
              </div>
              <label className="check"><input name="youtubeContainsSyntheticMedia" type="checkbox" defaultChecked={youtube.containsSyntheticMedia} /> KI/synthetische Inhalte bei YouTube deklarieren</label>
              <label className="check"><input name="youtubeSelfDeclaredMadeForKids" type="checkbox" defaultChecked={youtube.selfDeclaredMadeForKids} /> Video als „für Kinder“ deklarieren</label>
              <div className="oauth-checklist">
                <strong>Für die Verbindung nötig</strong>
                <ul>
                  <li>YouTube Data API v3 im Google-Cloud-Projekt aktivieren.</li>
                  <li>OAuth Consent Screen konfigurieren und Testnutzer hinzufügen, solange die App nicht veröffentlicht ist.</li>
                  <li>OAuth Client vom Typ „Web application“ mit obiger Redirect URI erstellen.</li>
                  <li>Scopes: <code>{YOUTUBE_UPLOAD_SCOPE}</code> und <code>{YOUTUBE_READONLY_SCOPE}</code>.</li>
                </ul>
              </div>
              {youtubeStatus.tokenExpiresAt ? <p className="muted">Access Token gültig bis: {youtubeStatus.tokenExpiresAt}</p> : null}
              {youtubeStatus.lastUploadAt ? <p className="muted">Letzter erfolgreicher Upload: {youtubeStatus.lastUploadAt} · Video-ID {youtubeStatus.lastUploadId}</p> : null}
              <div className="service-actions">
                <button formAction={connectYoutube}>Speichern und YouTube verbinden</button>
                <button className="secondary-button" formAction={refreshYoutubeConnection}>Verbindung prüfen</button>
                <button className="danger-button" formAction={disconnectYoutubeAction}>YouTube trennen</button>
              </div>
            </section>

            <section className="service-panel twitch-panel">
              <div className="service-panel-header"><h3>Twitch</h3><a className="help-icon" href="#twitch-oauth-help" aria-label="Twitch-Verbindungsanleitung öffnen">?</a></div>
              <div id="twitch-oauth-help" className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="twitch-help-title">
                <a className="modal-backdrop" href="#settings" aria-label="Anleitung schließen" />
                <div className="modal-card"><div className="modal-header"><div><p className="eyebrow">Twitch OAuth Setup</p><h2 id="twitch-help-title">Twitch verbinden</h2></div><a className="modal-close" href="#settings">×</a></div>
                  <ol className="step-list">
                    <li><strong>Twitch Developer Console öffnen.</strong><p>Öffne die <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">Twitch Developer Console</a>, aktiviere bei Bedarf 2FA und registriere eine Anwendung.</p></li>
                    <li><strong>OAuth Redirect URL hinterlegen.</strong><p>Trage exakt diese URL ein:</p><code className="copy-value">{suggestedTwitchRedirectUri}</code></li>
                    <li><strong>Kategorie wählen.</strong><p>Für diese serverseitige Webanwendung passt in der Regel „Website Integration“.</p></li>
                    <li><strong>Client ID und Secret übernehmen.</strong><p>Kopiere die Client ID, erzeuge ein neues Secret und trage beides hier ein.</p></li>
                    <li><strong>Berechtigung.</strong><p>Die App fordert minimal <code>{TWITCH_SCOPES.join(' ')}</code> an. Damit kann sie Streamtitel, Kategorie und Tags verwalten sowie Live-Marker setzen.</p></li>
                    <li><strong>Verbinden.</strong><p>Klicke auf „Speichern und Twitch verbinden“, melde dich mit dem Broadcaster-Konto an und bestätige den Zugriff.</p></li>
                  </ol><p className="muted">Offizielle Referenzen: <a href="https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/" target="_blank" rel="noreferrer">OAuth Authorization Code Flow</a> und <a href="https://dev.twitch.tv/docs/api/reference/" target="_blank" rel="noreferrer">Twitch Helix API</a>.</p>
                </div>
              </div>
              <div id="twitch-connected" className="service-status"><span className={twitchStatus.connected ? 'badge ok' : 'badge muted-badge'}>{twitchStatus.connected ? 'Twitch verbunden' : 'Twitch nicht verbunden'}</span></div>
              {twitchStatus.broadcasterId ? <p>Kanal: <a href={twitchStatus.channelUrl} target="_blank" rel="noreferrer">{twitchStatus.broadcasterName || twitchStatus.broadcasterLogin}</a></p> : null}
              {twitchStatus.lastError ? <p className="error">Twitch-Verbindung: {twitchStatus.lastError}</p> : null}
              <label>Twitch Client ID</label><input name="twitchClientId" defaultValue={twitch.clientId} autoComplete="off" />
              <label>Twitch Client Secret</label><input name="twitchClientSecret" type="password" placeholder={twitch.clientSecret ? 'gespeichert – leer lassen zum Behalten' : ''} autoComplete="off" />
              <label>OAuth Redirect URI</label><input name="twitchRedirectUri" defaultValue={suggestedTwitchRedirectUri} />
              <div className="oauth-checklist"><strong>Benötigte Twitch-Konfiguration</strong><ul><li>Anwendung unter dev.twitch.tv registrieren.</li><li>Obige Redirect URI exakt eintragen.</li><li>OAuth Authorization Code Flow verwenden; Tokens werden serverseitig gespeichert und erneuert.</li><li>Scope: <code>{TWITCH_SCOPES.join(' ')}</code>.</li></ul></div>
              {twitchStatus.tokenExpiresAt ? <p className="muted">Access Token gültig bis: {twitchStatus.tokenExpiresAt}</p> : null}
              <div className="service-actions"><button formAction={connectTwitch}>Speichern und Twitch verbinden</button><button className="secondary-button" formAction={refreshTwitchConnection}>Verbindung prüfen</button><button className="danger-button" formAction={disconnectTwitchAction}>Twitch trennen</button></div>
            </section>
          </div>
          <button>Dienste speichern</button>
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
            <option value="generated">Lokal per SVG/FFmpeg erzeugen</option>
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
            <option value="generated">Lokal per SVG/FFmpeg erzeugen</option>
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
          <label className="check"><input name="useSourceImages" type="checkbox" defaultChecked={video.useSourceImages} /> Artikelbild der Quelle lokal in die Videoszenen übernehmen</label>
          <p className="muted">Ist kein Artikelbild erreichbar, erzeugt die Pipeline automatisch lokale, lesbare Nachrichtengrafiken.</p>
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
            <p className="muted">Erzeugt eine eigenständige redaktionelle Fassung statt einer Kopie des Quelltexts. Die Quelle wird transparent genannt und der Originalbeitrag in der Videobeschreibung immer verlinkt.</p>
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
          <p className="muted">Der vollständige Originallink und eine faire Quellenempfehlung werden unabhängig von dieser Vorlage automatisch angehängt.</p>
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
