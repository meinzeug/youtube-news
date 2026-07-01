import crypto from 'node:crypto';
import { getSettings, setSettings } from './db';

export const TWITCH_SCOPES = ['channel:manage:broadcast'] as const;

export type TwitchSettings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
};

export function normalizeTwitchSettings(input: Record<string, unknown> = {}): TwitchSettings {
  return {
    clientId: String(input.twitchClientId || ''),
    clientSecret: String(input.twitchClientSecret || ''),
    redirectUri: String(input.twitchRedirectUri || ''),
    accessToken: String(input.twitchAccessToken || ''),
    refreshToken: String(input.twitchRefreshToken || ''),
    tokenExpiresAt: String(input.twitchTokenExpiresAt || ''),
    broadcasterId: String(input.twitchBroadcasterId || ''),
    broadcasterLogin: String(input.twitchBroadcasterLogin || ''),
    broadcasterName: String(input.twitchBroadcasterName || ''),
  };
}

export function getTwitchStatus(input = getSettings() as Record<string, unknown>) {
  const settings = normalizeTwitchSettings(input);
  return {
    configured: Boolean(settings.clientId && settings.clientSecret && settings.redirectUri),
    connected: Boolean(settings.accessToken && settings.broadcasterId),
    broadcasterId: settings.broadcasterId,
    broadcasterLogin: settings.broadcasterLogin,
    broadcasterName: settings.broadcasterName,
    channelUrl: settings.broadcasterLogin ? `https://twitch.tv/${settings.broadcasterLogin}` : '',
    tokenExpiresAt: settings.tokenExpiresAt,
    lastError: String(input.twitchLastConnectionError || ''),
  };
}

export function startTwitchOAuth() {
  const settings = normalizeTwitchSettings(getSettings() as Record<string, unknown>);
  if (!settings.clientId || !settings.clientSecret || !settings.redirectUri) throw new Error('Twitch Client ID, Client Secret und Redirect URI fehlen.');
  const state = crypto.randomBytes(24).toString('hex');
  setSettings({ twitchOAuthState: state, twitchLastConnectionError: '' });
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', settings.redirectUri);
  url.searchParams.set('scope', TWITCH_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('force_verify', 'true');
  return url.toString();
}

export async function finishTwitchOAuth(code: string, state: string) {
  const raw = getSettings() as Record<string, unknown>;
  const settings = normalizeTwitchSettings(raw);
  if (!state || state !== String(raw.twitchOAuthState || '')) throw new Error('Ungültiger Twitch OAuth-State. Bitte Verbindung neu starten.');
  const body = new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, code, grant_type: 'authorization_code', redirect_uri: settings.redirectUri });
  const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error(`Twitch Token-Austausch fehlgeschlagen (${response.status}): ${(await response.text()).slice(0, 260)}`);
  const tokens = await response.json() as { access_token: string; refresh_token: string; expires_in: number; scope?: string[] };
  setSettings({ twitchAccessToken: tokens.access_token, twitchRefreshToken: tokens.refresh_token, twitchTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(), twitchGrantedScopes: (tokens.scope || []).join(' '), twitchOAuthState: '' });
  return verifyTwitchConnection();
}

export async function verifyTwitchConnection() {
  const accessToken = await getValidAccessToken();
  const validation = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!validation.ok) throw new Error(`Twitch Token ungültig (${validation.status}).`);
  const valid = await validation.json() as { user_id?: string; login?: string; expires_in?: number; scopes?: string[] };
  const users = await helix<{ data: { id: string; login: string; display_name: string }[] }>('/users', {}, accessToken);
  const user = users.data[0];
  if (!user) throw new Error('Twitch-Konto konnte nicht geladen werden.');
  setSettings({ twitchBroadcasterId: user.id, twitchBroadcasterLogin: user.login, twitchBroadcasterName: user.display_name, twitchTokenExpiresAt: new Date(Date.now() + Number(valid.expires_in || 0) * 1000).toISOString(), twitchGrantedScopes: (valid.scopes || []).join(' '), twitchLastConnectionError: '', twitchConnectedAt: new Date().toISOString() });
  return user;
}

export async function getTwitchChannel() {
  const settings = normalizeTwitchSettings(getSettings() as Record<string, unknown>);
  if (!settings.broadcasterId) return null;
  const accessToken = await getValidAccessToken();
  const [channel, stream] = await Promise.all([
    helix<{ data: { broadcaster_id: string; broadcaster_name: string; broadcaster_login: string; game_name: string; title: string; tags: string[] }[] }>('/channels', { broadcaster_id: settings.broadcasterId }, accessToken),
    helix<{ data: { id: string; title: string; viewer_count: number; started_at: string; thumbnail_url: string }[] }>('/streams', { user_id: settings.broadcasterId }, accessToken),
  ]);
  return { channel: channel.data[0] || null, stream: stream.data[0] || null };
}

export async function updateTwitchChannel(input: { title: string; gameId?: string; tags?: string[] }) {
  const settings = normalizeTwitchSettings(getSettings() as Record<string, unknown>);
  if (!settings.broadcasterId) throw new Error('Twitch ist nicht verbunden.');
  const accessToken = await getValidAccessToken();
  const body: Record<string, unknown> = { title: input.title.slice(0, 140) };
  if (input.gameId) body.game_id = input.gameId;
  if (input.tags) body.tags = input.tags.slice(0, 10).map((tag) => tag.slice(0, 25));
  await helix('/channels', { broadcaster_id: settings.broadcasterId }, accessToken, { method: 'PATCH', body: JSON.stringify(body) });
  setSettings({ twitchLastChannelUpdateAt: new Date().toISOString(), twitchLastConnectionError: '' });
}

export async function createTwitchMarker(description: string) {
  const settings = normalizeTwitchSettings(getSettings() as Record<string, unknown>);
  if (!settings.broadcasterId) throw new Error('Twitch ist nicht verbunden.');
  const accessToken = await getValidAccessToken();
  return helix('/streams/markers', {}, accessToken, { method: 'POST', body: JSON.stringify({ user_id: settings.broadcasterId, description: description.slice(0, 140) }) });
}

export function disconnectTwitch() {
  setSettings({ twitchAccessToken: '', twitchRefreshToken: '', twitchTokenExpiresAt: '', twitchBroadcasterId: '', twitchBroadcasterLogin: '', twitchBroadcasterName: '', twitchGrantedScopes: '', twitchConnectedAt: '', twitchOAuthState: '' });
}

async function getValidAccessToken() {
  let settings = normalizeTwitchSettings(getSettings() as Record<string, unknown>);
  if (!settings.accessToken) throw new Error('Twitch ist nicht verbunden.');
  const expiresSoon = !settings.tokenExpiresAt || new Date(settings.tokenExpiresAt).getTime() < Date.now() + 120_000;
  if (!expiresSoon) return settings.accessToken;
  if (!settings.refreshToken) throw new Error('Twitch Refresh Token fehlt. Bitte neu verbinden.');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: settings.refreshToken, client_id: settings.clientId, client_secret: settings.clientSecret });
  const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) throw new Error(`Twitch Token konnte nicht erneuert werden (${response.status}).`);
  const token = await response.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string[] };
  setSettings({ twitchAccessToken: token.access_token, twitchRefreshToken: token.refresh_token || settings.refreshToken, twitchTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(), twitchGrantedScopes: (token.scope || []).join(' ') });
  settings = normalizeTwitchSettings(getSettings() as Record<string, unknown>);
  return settings.accessToken;
}

async function helix<T = unknown>(pathname: string, query: Record<string, string>, accessToken: string, init: RequestInit = {}) {
  const settings = normalizeTwitchSettings(getSettings() as Record<string, unknown>);
  const url = new URL(`https://api.twitch.tv/helix${pathname}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': settings.clientId, 'Content-Type': 'application/json', ...init.headers } });
  if (response.status === 204) return {} as T;
  if (!response.ok) throw new Error(`Twitch API ${pathname} fehlgeschlagen (${response.status}): ${(await response.text()).slice(0, 260)}`);
  return response.json() as Promise<T>;
}
