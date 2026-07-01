import { askOpenRouter } from './ai';
import { sql } from './db';
import { runPipeline } from './pipeline';
import { uploadArticleToYoutube } from './youtube';

export type EditorialCampaign = {
  id: number;
  name: string;
  topic: string;
  instructions: string;
  cadenceMinutes: number;
  status: string;
  targetChannel: string;
  autoUpload: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastResult: string | null;
};

export function createCampaign(input: { name: string; topic: string; instructions?: string; cadenceMinutes?: number; targetChannel?: string; autoUpload?: boolean; startNow?: boolean }) {
  const cadence = Math.max(15, Math.min(10_080, Math.round(Number(input.cadenceMinutes || 60))));
  const topic = input.topic.trim();
  if (!topic) throw new Error('Kampagnenthema fehlt.');
  const existing = sql.prepare("select id from editorial_campaigns where lower(topic)=lower(?) and status='active'").get(topic) as { id: number } | undefined;
  if (existing) return existing.id;
  const nextRunAt = input.startNow === false ? new Date(Date.now() + cadence * 60_000).toISOString() : new Date().toISOString();
  const result = sql.prepare("insert into editorial_campaigns(name,topic,instructions,cadenceMinutes,status,targetChannel,autoUpload,nextRunAt,createdBy) values(?,?,?,?,'active',?,?,?,'CEO')").run(input.name.trim() || topic, topic, input.instructions || '', cadence, input.targetChannel || 'YouTube', input.autoUpload ? 1 : 0, nextRunAt);
  const campaignId = Number(result.lastInsertRowid);
  createCampaignSchedule(campaignId, 24);
  sql.prepare("insert into editorial_tasks(title,description,department,assignee,status,priority,createdBy) values(?,?,?,?,?,?,?)").run(`Kampagne steuern: ${input.name || topic}`, `${topic} · alle ${cadence} Minuten. Ergebnisse und Fehler im Kampagnenmonitor prüfen.`, 'Leitung', 'Mara', 'in_progress', 'high', 'CEO-Auftrag');
  return campaignId;
}

export function createCampaignSchedule(campaignId: number, horizonHours = 24) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error('Kampagne nicht gefunden.');
  const slots = Math.max(1, Math.min(168, Math.floor(horizonHours * 60 / campaign.cadenceMinutes)));
  const start = campaign.nextRunAt ? new Date(campaign.nextRunAt).getTime() : Date.now();
  const insert = sql.prepare("insert into editorial_calendar(title,channel,contentType,status,scheduledAt,notes) values(?,?,?,'planned',?,?)");
  const transaction = sql.transaction(() => {
    for (let index = 0; index < slots; index += 1) {
      const scheduledAt = new Date(start + index * campaign.cadenceMinutes * 60_000).toISOString().slice(0, 16);
      const exists = sql.prepare("select 1 from editorial_calendar where title=? and scheduledAt=?").get(campaign.name, scheduledAt);
      if (!exists) insert.run(campaign.name, campaign.targetChannel, 'Video', scheduledAt, `Automatische Kampagne #${campaign.id}: ${campaign.topic}`);
    }
  });
  transaction();
}

export async function runDueCampaigns(limit = 2) {
  const campaigns = sql.prepare("select * from editorial_campaigns where status='active' and (nextRunAt is null or datetime(nextRunAt)<=datetime('now')) order by nextRunAt limit ?").all(Math.max(1, Math.min(10, limit))) as EditorialCampaign[];
  const results: { campaignId: number; ok: boolean; articleId?: number; video?: string; error?: string }[] = [];
  for (const campaign of campaigns) {
    const nextRunAt = new Date(Date.now() + campaign.cadenceMinutes * 60_000).toISOString();
    const reserved = sql.prepare("update editorial_campaigns set nextRunAt=?,lastRunAt=CURRENT_TIMESTAMP,lastResult='Lauf gestartet',updatedAt=CURRENT_TIMESTAMP where id=? and status='active' and (nextRunAt is null or datetime(nextRunAt)<=datetime('now'))").run(nextRunAt, campaign.id);
    if (reserved.changes === 1) results.push(await runCampaign(campaign, true));
  }
  return results;
}

export async function runCampaign(campaignOrId: EditorialCampaign | number, reserved = false) {
  const campaign = typeof campaignOrId === 'number' ? getCampaign(campaignOrId) : campaignOrId;
  if (!campaign) throw new Error('Kampagne nicht gefunden.');
  const nextRunAt = new Date(Date.now() + campaign.cadenceMinutes * 60_000).toISOString();
  // Reserve the next slot before expensive work so parallel cron calls cannot duplicate a run.
  if (!reserved) sql.prepare("update editorial_campaigns set nextRunAt=?,lastRunAt=CURRENT_TIMESTAMP,lastResult='Lauf gestartet',updatedAt=CURRENT_TIMESTAMP where id=?").run(nextRunAt, campaign.id);
  createCampaignSchedule(campaign.id, 24);
  let runId = 0;
  try {
    const articleId = await selectCampaignArticle(campaign);
    if (!articleId) throw new Error('Kein unverarbeiteter Artikel für diese Kampagne verfügbar.');
    const created = sql.prepare("insert into editorial_campaign_runs(campaignId,articleId,status,startedAt,log) values(?,?,'running',CURRENT_TIMESTAMP,?)").run(campaign.id, articleId, `Thema: ${campaign.topic}`);
    runId = Number(created.lastInsertRowid);
    const video = await runPipeline(articleId);
    let youtubeUrl = '';
    if (campaign.autoUpload) {
      const upload = await uploadArticleToYoutube(articleId);
      if (!upload.ok) throw new Error(upload.message || 'YouTube-Upload fehlgeschlagen.');
      youtubeUrl = upload.url || '';
    }
    sql.prepare("update editorial_campaign_runs set status='completed',videoPath=?,youtubeUrl=?,completedAt=CURRENT_TIMESTAMP,log=? where id=?").run(video, youtubeUrl, 'Video erfolgreich erzeugt.', runId);
    sql.prepare("update editorial_campaigns set lastResult=?,updatedAt=CURRENT_TIMESTAMP where id=?").run(`Video für Artikel ${articleId} erzeugt: ${video}`, campaign.id);
    sql.prepare("update editorial_calendar set status='done',updatedAt=CURRENT_TIMESTAMP where id=(select id from editorial_calendar where notes like ? and status='planned' order by scheduledAt limit 1)").run(`%Kampagne #${campaign.id}:%`);
    return { campaignId: campaign.id, ok: true, articleId, video };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Kampagnenfehler';
    if (runId) sql.prepare("update editorial_campaign_runs set status='failed',completedAt=CURRENT_TIMESTAMP,log=? where id=?").run(message, runId);
    else sql.prepare("insert into editorial_campaign_runs(campaignId,status,startedAt,completedAt,log) values(?,'failed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)").run(campaign.id, message);
    sql.prepare("update editorial_campaigns set lastResult=?,updatedAt=CURRENT_TIMESTAMP where id=?").run(`Fehler: ${message}`, campaign.id);
    return { campaignId: campaign.id, ok: false, error: message };
  }
}

export function getCampaign(id: number) {
  return sql.prepare('select * from editorial_campaigns where id=?').get(id) as EditorialCampaign | undefined;
}

async function selectCampaignArticle(campaign: EditorialCampaign) {
  const candidates = sql.prepare("select id,title,url,substr(rawText,1,900) rawText from articles where status in ('new','scripted') and id not in (select articleId from editorial_campaign_runs where articleId is not null and status in ('running','completed')) order by createdAt desc limit 30").all() as { id: number; title: string; url: string; rawText: string }[];
  if (!candidates.length) return null;
  const tokens = campaign.topic.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((token) => token.length > 2);
  const scored = candidates.map((article) => ({ article, score: tokens.reduce((sum, token) => sum + (`${article.title} ${article.rawText}`.toLowerCase().includes(token) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score);
  const fallbackId = scored[0]?.article.id || candidates[0].id;
  const schema = { type: 'object', properties: { articleId: { type: 'integer' }, reason: { type: 'string' } }, required: ['articleId', 'reason'], additionalProperties: false };
  const result = await askOpenRouter({ scenario: 'triage', system: 'Du wählst für eine redaktionelle Themenkampagne genau einen passenden Artikel aus. Nutze ausschließlich eine gelieferte ID. Das Thema ist eine redaktionelle Perspektive und muss nicht wörtlich im Titel stehen. Wähle den stärksten belegbaren Beitrag. Antworte als JSON.', prompt: `Kampagne: ${campaign.topic}\nVorgaben: ${campaign.instructions}\nKandidaten: ${JSON.stringify(candidates)}`, fallback: JSON.stringify({ articleId: fallbackId, reason: 'Lokale Auswahl nach Aktualität und Themenbegriffen.' }), jsonSchema: schema, maxTokens: 350 });
  try {
    const selected = JSON.parse(result.content) as { articleId: number };
    return candidates.some((article) => article.id === Number(selected.articleId)) ? Number(selected.articleId) : fallbackId;
  } catch { return fallbackId; }
}
