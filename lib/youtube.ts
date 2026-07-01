import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSettings, setSettings, sql, type Article } from './db';
import { shareYoutubeVideo } from './social';
import { normalizeVideoSettings, type VideoSettings } from './video-settings';
import { ensureSourceAttribution, sourceLabel } from './source-attribution';

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_SCOPES = [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE];

type RawSettings = Record<string, unknown>;

type YoutubeTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type YoutubeSettings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  uploadMode: 'prepared' | 'api';
  categoryId: string;
  containsSyntheticMedia: boolean;
  selfDeclaredMadeForKids: boolean;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  grantedScopes: string;
  channelId: string;
  channelTitle: string;
  channelUrl: string;
  oauthState: string;
  lastConnectionError: string;
  lastUploadError: string;
  lastUploadAt: string;
  lastUploadId: string;
};

export type YoutubeConnectionStatus = {
  configured: boolean;
  connected: boolean;
  canUpload: boolean;
  uploadMode: 'prepared' | 'api';
  channelTitle: string;
  channelId: string;
  channelUrl: string;
  tokenExpiresAt: string;
  missing: string[];
  lastConnectionError: string;
  lastUploadError: string;
  lastUploadAt: string;
  lastUploadId: string;
};

export type YoutubeUploadMetadata = {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: string;
  defaultLanguage: string;
  categoryId: string;
  containsSyntheticMedia: boolean;
  selfDeclaredMadeForKids: boolean;
};

export type YoutubeUploadResult =
  | {
      ok: true;
      mode: 'prepared' | 'api';
      url: string;
      videoId?: string;
      metadata: YoutubeUploadMetadata;
      social: unknown;
      note?: string;
    }
  | {
      ok: false;
      mode: 'api' | 'error';
      message: string;
      metadata?: YoutubeUploadMetadata;
      note?: string;
    };

export function normalizeYoutubeSettings(input: RawSettings): YoutubeSettings {
  return {
    clientId: asString(input.youtubeClientId),
    clientSecret: asString(input.youtubeClientSecret),
    redirectUri: asString(input.youtubeRedirectUri),
    uploadMode: input.youtubeUploadMode === 'api' ? 'api' : 'prepared',
    categoryId: asString(input.youtubeCategoryId) || '25',
    containsSyntheticMedia: asBool(input.youtubeContainsSyntheticMedia, true),
    selfDeclaredMadeForKids: asBool(input.youtubeSelfDeclaredMadeForKids, false),
    accessToken: asString(input.youtubeAccessToken),
    refreshToken: asString(input.youtubeRefreshToken),
    tokenExpiresAt: asString(input.youtubeTokenExpiresAt),
    grantedScopes: asString(input.youtubeGrantedScopes),
    channelId: asString(input.youtubeChannelId),
    channelTitle: asString(input.youtubeChannelTitle),
    channelUrl: asString(input.youtubeChannelUrl),
    oauthState: asString(input.youtubeOAuthState),
    lastConnectionError: asString(input.youtubeLastConnectionError),
    lastUploadError: asString(input.youtubeLastUploadError),
    lastUploadAt: asString(input.youtubeLastUploadAt),
    lastUploadId: asString(input.youtubeLastUploadId),
  };
}

export function getYoutubeConnectionStatus(input: RawSettings): YoutubeConnectionStatus {
  const settings = normalizeYoutubeSettings(input);
  const missing = [
    !settings.clientId && 'OAuth Client ID',
    !settings.clientSecret && 'OAuth Client Secret',
    !settings.refreshToken && 'Refresh Token',
  ].filter(Boolean) as string[];
  const configured = Boolean(settings.clientId && settings.clientSecret);
  const connected = Boolean(configured && settings.refreshToken);
  return {
    configured,
    connected,
    canUpload: connected && settings.uploadMode === 'api',
    uploadMode: settings.uploadMode,
    channelTitle: settings.channelTitle,
    channelId: settings.channelId,
    channelUrl: settings.channelUrl,
    tokenExpiresAt: settings.tokenExpiresAt,
    missing,
    lastConnectionError: settings.lastConnectionError,
    lastUploadError: settings.lastUploadError,
    lastUploadAt: settings.lastUploadAt,
    lastUploadId: settings.lastUploadId,
  };
}

export function getYoutubeRedirectUri(requestUrl: string, settings: YoutubeSettings) {
  if (settings.redirectUri) return settings.redirectUri;
  return new URL('/api/youtube/oauth/callback', requestUrl).toString();
}

export function createYoutubeAuthorizationUrl(settings: YoutubeSettings, redirectUri: string) {
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error('YouTube OAuth Client ID und Client Secret fehlen.');
  }

  const state = crypto.randomBytes(24).toString('hex');
  setSettings({
    youtubeOAuthState: state,
    youtubeOAuthStartedAt: new Date().toISOString(),
    youtubeLastConnectionError: '',
  });

  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeYoutubeOAuth(code: string, state: string | null, requestUrl: string) {
  const raw = getSettings() as RawSettings;
  const settings = normalizeYoutubeSettings(raw);
  if (!code) throw new Error('Google OAuth Callback enthält keinen Code.');
  if (!settings.oauthState || settings.oauthState !== state) throw new Error('OAuth-State stimmt nicht überein.');

  const redirectUri = getYoutubeRedirectUri(requestUrl, settings);
  const tokens = await requestGoogleToken({
    code,
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const accessToken = tokens.access_token;
  if (!accessToken) throw new Error('Google hat keinen Access Token zurückgegeben.');

  const refreshToken = tokens.refresh_token || settings.refreshToken;
  if (!refreshToken) {
    throw new Error('Google hat keinen Refresh Token zurückgegeben. Starte die Verbindung erneut mit Consent-Prompt.');
  }

  const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  const channel = await fetchYoutubeChannel(accessToken);

  setSettings({
    youtubeAccessToken: accessToken,
    youtubeRefreshToken: refreshToken,
    youtubeTokenExpiresAt: expiresAt,
    youtubeGrantedScopes: tokens.scope || YOUTUBE_SCOPES.join(' '),
    youtubeChannelId: channel.id,
    youtubeChannelTitle: channel.title,
    youtubeChannelUrl: channel.url,
    youtubeConnectedAt: new Date().toISOString(),
    youtubeOAuthState: '',
    youtubeLastConnectionError: '',
  });

  return channel;
}

export async function verifyYoutubeConnection() {
  const token = await getValidYoutubeAccessToken();
  const channel = await fetchYoutubeChannel(token);
  setSettings({
    youtubeChannelId: channel.id,
    youtubeChannelTitle: channel.title,
    youtubeChannelUrl: channel.url,
    youtubeLastConnectionError: '',
  });
  return channel;
}

export function disconnectYoutube() {
  setSettings({
    youtubeAccessToken: '',
    youtubeRefreshToken: '',
    youtubeTokenExpiresAt: '',
    youtubeGrantedScopes: '',
    youtubeChannelId: '',
    youtubeChannelTitle: '',
    youtubeChannelUrl: '',
    youtubeOAuthState: '',
    youtubeConnectedAt: '',
    youtubeLastConnectionError: '',
  });
}

export async function uploadArticleToYoutube(articleId: number): Promise<YoutubeUploadResult> {
  const article = sql.prepare('select * from articles where id=?').get(articleId) as Article | undefined;
  if (!article) return { ok: false, mode: 'error', message: 'Artikel nicht gefunden.' };
  if (!article.videoPath) return { ok: false, mode: 'error', message: 'Artikel hat noch kein gerendertes Video.' };

  const raw = getSettings() as RawSettings;
  const youtube = normalizeYoutubeSettings(raw);
  const videoSettings = normalizeVideoSettings(raw);
  const metadata = await buildYoutubeMetadata(article, videoSettings, youtube);

  if (youtube.uploadMode !== 'api') {
    return prepareYoutubeUpload(article.id, metadata, 'Echter YouTube-Upload ist deaktiviert; die App erzeugt nur einen vorbereiteten Link.');
  }

  const status = getYoutubeConnectionStatus(raw);
  if (!status.connected) {
    const message = `YouTube ist nicht verbunden. Fehlend: ${status.missing.join(', ') || 'OAuth-Verbindung'}.`;
    setUploadFailed(article.id, message);
    return { ok: false, mode: 'api', message, metadata };
  }

  try {
    const accessToken = await getValidYoutubeAccessToken();
    const upload = await uploadVideoFile(article.videoPath, metadata, accessToken);
    const url = `https://www.youtube.com/watch?v=${upload.id}`;
    sql.prepare("update articles set youtubeUrl=?, status='uploaded', updatedAt=CURRENT_TIMESTAMP where id=?").run(url, article.id);
    setSettings({
      youtubeLastUploadAt: new Date().toISOString(),
      youtubeLastUploadId: upload.id,
      youtubeLastUploadError: '',
    });
    const social = await shareYoutubeVideo(article.id, url);
    return { ok: true, mode: 'api', url, videoId: upload.id, metadata, social };
  } catch (error) {
    const message = errorMessage(error);
    setUploadFailed(article.id, message);
    setSettings({ youtubeLastUploadError: message });
    return { ok: false, mode: 'api', message, metadata };
  }
}

async function prepareYoutubeUpload(articleId: number, metadata: YoutubeUploadMetadata, note: string): Promise<YoutubeUploadResult> {
  const url = `https://studio.youtube.com/mock-upload/${articleId}`;
  sql.prepare("update articles set youtubeUrl=?, status='upload_prepared', updatedAt=CURRENT_TIMESTAMP where id=?").run(url, articleId);
  const social = await shareYoutubeVideo(articleId, url);
  return { ok: true, mode: 'prepared', url, metadata, social, note };
}

function setUploadFailed(articleId: number, message: string) {
  sql.prepare("update articles set status='upload_failed', updatedAt=CURRENT_TIMESTAMP where id=?").run(articleId);
  sql.prepare('insert into jobs(articleId, step, status, log) values(?,?,?,?)').run(articleId, 'youtube_upload', 'failed', message);
}

async function getValidYoutubeAccessToken() {
  const raw = getSettings() as RawSettings;
  const settings = normalizeYoutubeSettings(raw);
  if (!settings.clientId || !settings.clientSecret) throw new Error('YouTube OAuth Client ID oder Client Secret fehlen.');
  if (!settings.refreshToken) throw new Error('YouTube Refresh Token fehlt. Verbinde YouTube in den Einstellungen neu.');

  const expiresAt = Date.parse(settings.tokenExpiresAt);
  if (settings.accessToken && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) return settings.accessToken;

  const tokens = await requestGoogleToken({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    refresh_token: settings.refreshToken,
    grant_type: 'refresh_token',
  });
  if (!tokens.access_token) throw new Error('Google hat beim Refresh keinen Access Token zurückgegeben.');
  const tokenExpiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  setSettings({
    youtubeAccessToken: tokens.access_token,
    youtubeTokenExpiresAt: tokenExpiresAt,
    youtubeGrantedScopes: tokens.scope || settings.grantedScopes,
    youtubeLastConnectionError: '',
  });
  return tokens.access_token;
}

async function requestGoogleToken(params: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = (await response.json().catch(() => ({}))) as YoutubeTokenResponse;
  if (!response.ok) {
    throw new Error(body.error_description || body.error || `Google OAuth Fehler ${response.status}`);
  }
  return body;
}

async function fetchYoutubeChannel(accessToken: string) {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('mine', 'true');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await response.json().catch(() => ({}))) as {
    items?: { id?: string; snippet?: { title?: string; customUrl?: string } }[];
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message || `YouTube Kanalprüfung fehlgeschlagen (${response.status}).`);
  const item = body.items?.[0];
  if (!item?.id) throw new Error('Für dieses Google-Konto wurde kein YouTube-Kanal gefunden.');
  return {
    id: item.id,
    title: item.snippet?.title || item.id,
    url: `https://www.youtube.com/channel/${item.id}`,
  };
}

async function buildYoutubeMetadata(article: Article, videoSettings: VideoSettings, youtube: YoutubeSettings): Promise<YoutubeUploadMetadata> {
  const summary = article.videoDescription || article.rewrittenText || article.rawText;
  const chapters = await readChapterText(article.id);
  const source = article.sourceId ? sql.prepare('select name from sources where id=?').get(article.sourceId) as { name?: string } | undefined : undefined;
  const sourceName = sourceLabel(article.url, source?.name || '');
  const values = {
    title: article.title,
    summary,
    sourceUrl: article.url,
    chapters,
  };
  return {
    title: renderTemplate(videoSettings.youtubeTitleTemplate, values).slice(0, 100) || article.title.slice(0, 100),
    description: ensureSourceAttribution(renderTemplate(videoSettings.youtubeDescriptionTemplate, values), sourceName, article.url),
    tags: videoSettings.youtubeTags.split(',').map((tag) => tag.trim()).filter(Boolean),
    privacyStatus: videoSettings.privacyStatus,
    defaultLanguage: videoSettings.language,
    categoryId: youtube.categoryId,
    containsSyntheticMedia: youtube.containsSyntheticMedia,
    selfDeclaredMadeForKids: youtube.selfDeclaredMadeForKids,
  };
}

async function readChapterText(articleId: number) {
  const briefPath = path.join(process.cwd(), 'public', 'generated', `article-${articleId}-brief.md`);
  try {
    const brief = await fs.readFile(briefPath, 'utf8');
    const lines = brief.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === 'Kapitel:');
    if (start === -1) return '';
    const chapterLines: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (!line.trim()) break;
      if (line.startsWith('- ')) chapterLines.push(line.slice(2));
    }
    return chapterLines.join('\n');
  } catch {
    return '';
  }
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*(title|summary|sourceUrl|chapters)\s*}}/g, (_, key: string) => values[key] || '');
}

async function uploadVideoFile(videoPath: string, metadata: YoutubeUploadMetadata, accessToken: string) {
  const absolutePath = path.join(process.cwd(), 'public', videoPath.startsWith('/') ? videoPath : `/${videoPath}`);
  const stat = await fs.stat(absolutePath);
  const contentType = getVideoContentType(absolutePath);
  const body = {
    snippet: {
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      categoryId: metadata.categoryId,
      defaultLanguage: metadata.defaultLanguage,
    },
    status: {
      privacyStatus: metadata.privacyStatus,
      selfDeclaredMadeForKids: metadata.selfDeclaredMadeForKids,
      containsSyntheticMedia: metadata.containsSyntheticMedia,
    },
  };
  const json = JSON.stringify(body);
  const startResponse = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'Content-Length': String(Buffer.byteLength(json)),
      'X-Upload-Content-Length': String(stat.size),
      'X-Upload-Content-Type': contentType,
    },
    body: json,
  });

  if (!startResponse.ok) throw new Error(await youtubeError(startResponse, 'YouTube Upload-Session konnte nicht gestartet werden.'));
  const uploadUrl = startResponse.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube hat keine resumable Upload-URL zurückgegeben.');

  const file = await fs.readFile(absolutePath);
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Length': String(file.length),
      'Content-Type': contentType,
    },
    body: file,
  });

  const uploadBody = (await uploadResponse.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!uploadResponse.ok || !uploadBody.id) {
    throw new Error(uploadBody.error?.message || `YouTube Upload fehlgeschlagen (${uploadResponse.status}).`);
  }
  return { id: uploadBody.id };
}

async function youtubeError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  return body.error?.message || `${fallback} (${response.status})`;
}

function getVideoContentType(filename: string) {
  if (/\.webm$/i.test(filename)) return 'video/webm';
  if (/\.mov$/i.test(filename)) return 'video/quicktime';
  if (/\.mkv$/i.test(filename)) return 'video/x-matroska';
  return 'video/mp4';
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'on', 'yes'].includes(value.toLowerCase());
  return fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unbekannter YouTube-Fehler';
}
