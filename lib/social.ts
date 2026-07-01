import { sql } from './db';

export type SocialChannelKey = 'facebook' | 'instagram' | 'x' | 'linkedin' | 'threads' | 'tiktok' | 'mastodon' | 'telegram' | 'reddit' | 'pinterest';

export type SocialChannelDefinition = { key: SocialChannelKey; name: string; hint: string; placeholder: string };

export type SocialChannelSettings = { enabled: boolean; webhookUrl: string; accessToken: string; pageId: string; messageTemplate: string };
export type SocialSettings = { socialAutoShareEnabled: boolean; socialDefaultText: string; channels: Record<SocialChannelKey, SocialChannelSettings> };

export const socialChannels: SocialChannelDefinition[] = [
  { key: 'facebook', name: 'Facebook', hint: 'Page/Graph API oder Automations-Webhook', placeholder: 'https://graph.facebook.com/.../feed' },
  { key: 'instagram', name: 'Instagram', hint: 'Instagram Business API oder Zapier/Make', placeholder: 'https://graph.facebook.com/.../media' },
  { key: 'x', name: 'X / Twitter', hint: 'X API v2 oder Social-Webhook', placeholder: 'https://api.x.com/2/tweets' },
  { key: 'linkedin', name: 'LinkedIn', hint: 'Organization/User Share API', placeholder: 'https://api.linkedin.com/v2/ugcPosts' },
  { key: 'threads', name: 'Threads', hint: 'Threads API oder Automations-Webhook', placeholder: 'https://graph.threads.net/...' },
  { key: 'tiktok', name: 'TikTok', hint: 'Content Posting API oder Scheduler', placeholder: 'https://open.tiktokapis.com/...' },
  { key: 'mastodon', name: 'Mastodon', hint: 'Instanz-API /api/v1/statuses', placeholder: 'https://mastodon.social/api/v1/statuses' },
  { key: 'telegram', name: 'Telegram', hint: 'Bot API sendMessage', placeholder: 'https://api.telegram.org/botTOKEN/sendMessage' },
  { key: 'reddit', name: 'Reddit', hint: 'Submit API oder Automations-Webhook', placeholder: 'https://oauth.reddit.com/api/submit' },
  { key: 'pinterest', name: 'Pinterest', hint: 'Pins API oder Automations-Webhook', placeholder: 'https://api.pinterest.com/v5/pins' },
];

const defaultChannel = (channel: SocialChannelDefinition): SocialChannelSettings => ({
  enabled: false,
  webhookUrl: '',
  accessToken: '',
  pageId: '',
  messageTemplate: '{{title}}\n\nJetzt ansehen: {{youtubeUrl}}\nQuelle: {{sourceUrl}}',
});

const bool = (value: unknown, fallback = false) => value === undefined ? fallback : value === true || value === 'true' || value === 'on' || value === '1';

export function normalizeSocialSettings(input: Record<string, unknown> = {}): SocialSettings {
  const channels = Object.fromEntries(socialChannels.map((channel) => {
    const prefix = `social_${channel.key}_`;
    const legacy = input[channel.key] as Partial<SocialChannelSettings> | undefined;
    return [channel.key, {
      ...defaultChannel(channel),
      enabled: bool(input[`${prefix}enabled`], legacy?.enabled || false),
      webhookUrl: String(input[`${prefix}webhookUrl`] || legacy?.webhookUrl || ''),
      accessToken: String(input[`${prefix}accessToken`] || legacy?.accessToken || ''),
      pageId: String(input[`${prefix}pageId`] || legacy?.pageId || ''),
      messageTemplate: String(input[`${prefix}messageTemplate`] || legacy?.messageTemplate || defaultChannel(channel).messageTemplate),
    }];
  })) as Record<SocialChannelKey, SocialChannelSettings>;
  return {
    socialAutoShareEnabled: bool(input.socialAutoShareEnabled, false),
    socialDefaultText: String(input.socialDefaultText || 'Neues Video: {{title}}\n{{youtubeUrl}}'),
    channels,
  };
}

export function flattenSocialSettings(settings: SocialSettings): Record<string, unknown> {
  const out: Record<string, unknown> = { socialAutoShareEnabled: settings.socialAutoShareEnabled, socialDefaultText: settings.socialDefaultText };
  for (const [key, channel] of Object.entries(settings.channels)) {
    out[`social_${key}_enabled`] = channel.enabled;
    out[`social_${key}_webhookUrl`] = channel.webhookUrl;
    out[`social_${key}_accessToken`] = channel.accessToken;
    out[`social_${key}_pageId`] = channel.pageId;
    out[`social_${key}_messageTemplate`] = channel.messageTemplate;
  }
  return out;
}

export function renderSocialTemplate(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*(title|summary|sourceUrl|youtubeUrl|channel)\s*}}/g, (_, key) => values[key] || '');
}

export async function shareYoutubeVideo(articleId: number, youtubeUrl: string) {
  const { getSettings } = await import('./db');
  const settings = normalizeSocialSettings(getSettings() as Record<string, unknown>);
  const article = sql.prepare('select title,rawText,rewrittenText,url from articles where id=?').get(articleId) as { title: string; rawText: string; rewrittenText: string | null; url: string } | undefined;
  if (!settings.socialAutoShareEnabled || !article) return { ok: true, skipped: true, results: [] };
  const values = { title: article.title, summary: article.rewrittenText || article.rawText, sourceUrl: article.url, youtubeUrl, channel: '' };
  const results = [];
  for (const channel of socialChannels) {
    const cfg = settings.channels[channel.key];
    if (!cfg.enabled) continue;
    const message = renderSocialTemplate(cfg.messageTemplate || settings.socialDefaultText, { ...values, channel: channel.name });
    const result = await postToChannel(articleId, channel, cfg, message, youtubeUrl);
    results.push(result);
  }
  return { ok: results.every((r) => r.status !== 'failed'), skipped: false, results };
}

async function postToChannel(articleId: number, channel: SocialChannelDefinition, cfg: SocialChannelSettings, message: string, youtubeUrl: string) {
  const payload = { channel: channel.key, text: message, url: youtubeUrl, pageId: cfg.pageId || undefined };
  let status = 'prepared';
  let response = 'Kein Webhook/API-Endpunkt hinterlegt; Beitrag wurde zur manuellen Veröffentlichung vorbereitet.';
  if (cfg.webhookUrl) {
    try {
      const r = await fetch(cfg.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...(cfg.accessToken ? { authorization: `Bearer ${cfg.accessToken}` } : {}) }, body: JSON.stringify(payload) });
      status = r.ok ? 'posted' : 'failed';
      response = (await r.text()).slice(0, 1000) || `${r.status} ${r.statusText}`;
    } catch (error) {
      status = 'failed';
      response = error instanceof Error ? error.message : 'Unbekannter Fehler';
    }
  }
  sql.prepare('insert into social_posts(articleId, channel, status, message, response, createdAt) values(?,?,?,?,?,CURRENT_TIMESTAMP)').run(articleId, channel.key, status, message, response);
  return { channel: channel.key, status, response };
}
