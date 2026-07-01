import { askOpenRouter, getAiPolicy, type AiScenario } from './ai';
import { sql, type Article } from './db';

export const EDITORIAL_TEAM = [
  { key: 'chief', name: 'Mara', role: 'Chefredakteurin', department: 'Leitung', scenario: 'strategy' as AiScenario, mission: 'priorisiert Themen, schützt die Marke und übersetzt CEO-Ziele in klare Aufträge' },
  { key: 'newsdesk', name: 'Nico', role: 'Newsdesk-Leiter', department: 'Redaktion', scenario: 'triage' as AiScenario, mission: 'sichtet Quellen, bündelt Dubletten und erkennt zeitkritische Meldungen' },
  { key: 'research', name: 'Raya', role: 'Rechercheurin', department: 'Recherche', scenario: 'research' as AiScenario, mission: 'prüft Quellenlagen, offene Fragen und belastbare Gegenpositionen' },
  { key: 'author', name: 'Alex', role: 'Video-Autor', department: 'Produktion', scenario: 'drafting' as AiScenario, mission: 'erstellt eigenständige Artikel, Videoskripte, Titel und Beschreibungen' },
  { key: 'social', name: 'Sami', role: 'Growth & Social Lead', department: 'Distribution', scenario: 'social' as AiScenario, mission: 'plant plattformgerechte Ausspielung und führt Zuschauer zu YouTube und Twitch' },
  { key: 'standards', name: 'Vera', role: 'Standards & Fakten', department: 'Qualität', scenario: 'fact_check' as AiScenario, mission: 'markiert unbelegte Aussagen, Rechte-, Quellen- und Reputationsrisiken' },
] as const;

export function seedEditorialWorkspace() {
  const taskCount = (sql.prepare('select count(*) c from editorial_tasks').get() as { c: number }).c;
  if (!taskCount) {
    const insert = sql.prepare('insert into editorial_tasks(title,description,department,assignee,status,priority,createdBy) values(?,?,?,?,?,?,?)');
    insert.run('Markenmission und Wochenziele festlegen', 'CEO-Briefing in messbare Themen-, Reichweiten- und Qualitätsziele übersetzen.', 'Leitung', 'Mara', 'backlog', 'high', 'System');
    insert.run('YouTube- und Twitch-Formate synchronisieren', 'Aus jedem Livestream Highlights, Shorts, Artikel und Social-Clips ableiten.', 'Distribution', 'Sami', 'backlog', 'normal', 'System');
  }
}

export async function talkToEmployee(employeeKey: string, message: string) {
  const employee = EDITORIAL_TEAM.find((member) => member.key === employeeKey) || EDITORIAL_TEAM[0];
  const policy = getAiPolicy();
  const recent = sql.prepare('select author,role,content from editorial_messages order by id desc limit 10').all() as { author: string; role: string; content: string }[];
  const stats = getEditorialSnapshot();
  sql.prepare('insert into editorial_messages(author,role,content,createdAt) values(?,?,?,CURRENT_TIMESTAMP)').run('CEO', 'CEO', message);
  const fallback = localEmployeeReply(employee, message, stats);
  const result = await askOpenRouter({
    scenario: employee.scenario,
    system: `Du bist ${employee.name}, ${employee.role} bei der Medienmarke ${policy.brandName}. Deine Aufgabe: ${employee.mission}. Der Nutzer ist der CEO. Antworte auf Deutsch wie eine kompetente Führungskraft: direkt, konkret, mit Entscheidungen, Risiken und nächsten Schritten. Erfinde keine erledigten Arbeiten oder Fakten. Du darfst Aufgaben vorschlagen, aber kennzeichne Vorschläge. Markenmission: ${policy.mission}. Zielgruppe: ${policy.audience}. Aktueller Stand: ${JSON.stringify(stats)}.`,
    prompt: `Letzte Unterhaltung:\n${recent.reverse().map((row) => `${row.author} (${row.role}): ${row.content}`).join('\n').slice(-8000)}\n\nNeue Nachricht des CEO: ${message}`,
    fallback,
  });
  sql.prepare('insert into editorial_messages(author,role,content,model,promptTokens,completionTokens,costUsd,createdAt) values(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)').run(employee.name, employee.role, result.content, result.model, result.promptTokens, result.completionTokens, result.costUsd);
  return result;
}

export async function createEditorialPlan(goal: string) {
  const policy = getAiPolicy();
  const articles = sql.prepare("select id,title,url,substr(rawText,1,700) rawText from articles order by createdAt desc limit 12").all() as Pick<Article, 'id' | 'title' | 'url' | 'rawText'>[];
  const schema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      tasks: { type: 'array', minItems: 3, maxItems: 10, items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, department: { type: 'string' }, assignee: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, articleId: { type: ['integer', 'null'] } }, required: ['title', 'description', 'department', 'assignee', 'priority', 'articleId'], additionalProperties: false } },
      calendar: { type: 'array', maxItems: 8, items: { type: 'object', properties: { title: { type: 'string' }, channel: { type: 'string' }, contentType: { type: 'string' }, scheduledAt: { type: ['string', 'null'] }, articleId: { type: ['integer', 'null'] }, notes: { type: 'string' } }, required: ['title', 'channel', 'contentType', 'scheduledAt', 'articleId', 'notes'], additionalProperties: false } },
    },
    required: ['summary', 'tasks', 'calendar'],
    additionalProperties: false,
  };
  const fallbackPlan = buildLocalPlan(goal, articles);
  const result = await askOpenRouter({
    scenario: 'strategy',
    system: `Du bist die Chefredaktion von ${policy.brandName}. Erstelle einen realistischen Redaktionsplan als JSON. YouTube ist der primäre Evergreen-/Video-Kanal, Twitch der Live-Kanal, das Webmagazin ist SEO/Archiv und Social führt zu diesen Kanälen. Nutze nur vorhandene Artikel-IDs. Plane keine automatische Veröffentlichung sensibler Inhalte ohne Prüfung.`,
    prompt: `CEO-Ziel: ${goal}\nAktuelle Artikel: ${JSON.stringify(articles)}`,
    fallback: JSON.stringify(fallbackPlan),
    jsonSchema: schema,
    maxTokens: 1800,
  });
  let plan: typeof fallbackPlan;
  try { plan = JSON.parse(result.content); } catch { plan = fallbackPlan; }
  const insertTask = sql.prepare('insert into editorial_tasks(title,description,department,assignee,status,priority,articleId,createdBy) values(?,?,?,?,?,?,?,?)');
  const insertCalendar = sql.prepare('insert into editorial_calendar(title,channel,contentType,status,scheduledAt,articleId,notes) values(?,?,?,\'planned\',?,?,?)');
  const transaction = sql.transaction(() => {
    for (const task of plan.tasks || []) insertTask.run(String(task.title), String(task.description), String(task.department), String(task.assignee), 'backlog', normalizePriority(task.priority), nullableId(task.articleId), 'KI-Chefredaktion');
    for (const item of plan.calendar || []) insertCalendar.run(String(item.title), String(item.channel), String(item.contentType), item.scheduledAt || null, nullableId(item.articleId), String(item.notes || ''));
  });
  transaction();
  sql.prepare('insert into editorial_messages(author,role,content,model,promptTokens,completionTokens,costUsd,createdAt) values(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)').run('Mara', 'Chefredakteurin', plan.summary || 'Redaktionsplan wurde erstellt.', result.model, result.promptTokens, result.completionTokens, result.costUsd);
  return plan;
}

export async function runNewsdeskTriage(limit = 8) {
  const articles = sql.prepare("select id,title,url,substr(rawText,1,500) rawText from articles where id not in (select articleId from editorial_tasks where articleId is not null) order by createdAt desc limit ?").all(Math.max(1, Math.min(20, limit))) as Pick<Article, 'id' | 'title' | 'url' | 'rawText'>[];
  if (!articles.length) return { created: 0, fallback: false };
  const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { articleId: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, assignee: { type: 'string' } }, required: ['articleId', 'title', 'description', 'priority', 'assignee'], additionalProperties: false } } }, required: ['items'], additionalProperties: false };
  const fallback = { items: articles.map((article, index) => ({ articleId: article.id, title: `Prüfen: ${article.title}`, description: `Quellenlage bewerten und Eignung für YouTube, Twitch, Web oder Social festlegen. Original: ${article.url}`, priority: index === 0 ? 'high' : 'normal', assignee: 'Nico' })) };
  const result = await askOpenRouter({ scenario: 'triage', system: 'Du leitest den Newsdesk. Bewerte ausschließlich das gelieferte Material. Formuliere kurze redaktionelle Aufträge, priorisiere Aktualität und Relevanz, aber behaupte keine Verifikation. Nutze nur vorhandene articleId-Werte. Antworte als JSON.', prompt: JSON.stringify(articles), fallback: JSON.stringify(fallback), jsonSchema: schema, maxTokens: 700 });
  let plan = fallback;
  try { plan = JSON.parse(result.content); } catch { /* use deterministic fallback */ }
  const validIds = new Set(articles.map((article) => article.id));
  const insert = sql.prepare('insert into editorial_tasks(title,description,department,assignee,status,priority,articleId,createdBy) values(?,?,?,?,?,?,?,?)');
  let created = 0;
  const transaction = sql.transaction(() => {
    for (const item of plan.items || []) {
      const articleId = Number(item.articleId);
      if (!validIds.has(articleId)) continue;
      insert.run(String(item.title), String(item.description), 'Redaktion', String(item.assignee || 'Nico'), 'backlog', normalizePriority(item.priority), articleId, 'KI-Newsdesk');
      created += 1;
    }
  });
  transaction();
  return { created, fallback: result.fallback };
}

export async function publishArticleToMagazine(articleId: number) {
  const article = sql.prepare('select * from articles where id=?').get(articleId) as Article | undefined;
  if (!article) throw new Error('Artikel nicht gefunden.');
  const source = article.url;
  const schema = { type: 'object', properties: { title: { type: 'string' }, excerpt: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'excerpt', 'body'], additionalProperties: false };
  const fallback = { title: article.title, excerpt: article.rawText.slice(0, 220), body: `${article.rewrittenText || article.rawText}\n\nQuelle und weitere Hintergründe: ${source}` };
  const result = await askOpenRouter({
    scenario: 'drafting',
    system: 'Du bist Online-Redakteur. Erstelle eine eigenständige deutschsprachige Website-Fassung. Keine erfundenen Fakten, keine langen übernommenen Formulierungen. Trenne Nachricht, Einordnung und offenen Kontext. Verlinke die Originalquelle fair am Ende. Antworte als JSON.',
    prompt: `Titel: ${article.title}\nQuelle: ${source}\nMaterial: ${article.rewrittenText || article.rawText}`,
    fallback: JSON.stringify(fallback),
    jsonSchema: schema,
    maxTokens: 2200,
  });
  let post = fallback;
  try { post = JSON.parse(result.content); } catch { /* local fallback */ }
  const slug = uniqueSlug(String(post.title || article.title), articleId);
  sql.prepare("insert into brand_posts(articleId,slug,title,excerpt,body,sourceUrl,heroImage,status,publishedAt,createdAt,updatedAt) values(?,?,?,?,?,?,?,'published',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(articleId, slug, String(post.title), String(post.excerpt), String(post.body), source, article.imagePath || null);
  return slug;
}

export function getEditorialSnapshot() {
  const taskRows = sql.prepare('select status,count(*) c from editorial_tasks group by status').all() as { status: string; c: number }[];
  const taskCounts = Object.fromEntries(taskRows.map((row) => [row.status, row.c]));
  return {
    tasks: taskCounts,
    newArticles: (sql.prepare("select count(*) c from articles where status='new'").get() as { c: number }).c,
    videosReady: (sql.prepare("select count(*) c from articles where status='video_ready'").get() as { c: number }).c,
    scheduled: (sql.prepare("select count(*) c from editorial_calendar where status='planned'").get() as { c: number }).c,
    publishedPosts: (sql.prepare("select count(*) c from brand_posts where status='published'").get() as { c: number }).c,
  };
}

function localEmployeeReply(employee: typeof EDITORIAL_TEAM[number], message: string, stats: ReturnType<typeof getEditorialSnapshot>) {
  return `${employee.name} · ${employee.role}\n\nIch habe den Auftrag „${message.slice(0, 240)}“ aufgenommen. Aktuell sehe ich ${stats.newArticles} neue Meldungen, ${stats.videosReady} fertige Videos und ${stats.scheduled} geplante Veröffentlichungen. Mein Vorschlag: Ziel und Deadline festlegen, relevante Quellen prüfen, daraus einen klar verantworteten Auftrag erstellen und die Veröffentlichung erst nach Qualitätskontrolle freigeben.`;
}

function buildLocalPlan(goal: string, articles: Pick<Article, 'id' | 'title' | 'url' | 'rawText'>[]) {
  const top = articles.slice(0, 3);
  return {
    summary: `Lokaler Redaktionsplan für: ${goal}`,
    tasks: top.length ? top.map((article, index) => ({ title: article.title, description: `Meldung prüfen und als ${index === 0 ? 'YouTube-Hauptvideo' : 'Kurzformat'} aufbereiten.`, department: index === 0 ? 'Produktion' : 'Redaktion', assignee: index === 0 ? 'Alex' : 'Nico', priority: index === 0 ? 'high' : 'normal', articleId: article.id })) : [{ title: goal, description: 'CEO-Ziel konkretisieren und Quellenlage aufbauen.', department: 'Leitung', assignee: 'Mara', priority: 'high', articleId: null }],
    calendar: top.map((article, index) => ({ title: article.title, channel: index === 0 ? 'YouTube' : 'Webmagazin', contentType: index === 0 ? 'Video' : 'Artikel', scheduledAt: new Date(Date.now() + (index + 1) * 86_400_000).toISOString().slice(0, 16), articleId: article.id, notes: 'Vor Veröffentlichung Quellen- und Rechteprüfung.' })),
  };
}

function uniqueSlug(title: string, articleId: number) {
  const base = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || `artikel-${articleId}`;
  const exists = sql.prepare('select 1 from brand_posts where slug=?').get(base);
  return exists ? `${base}-${articleId}` : base;
}

function normalizePriority(value: unknown) { return ['low', 'normal', 'high', 'urgent'].includes(String(value)) ? String(value) : 'normal'; }
function nullableId(value: unknown) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
