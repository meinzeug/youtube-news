import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { sql, type Source } from './db';

const parser = new Parser({
  headers: {
    'user-agent': 'Mozilla/5.0 (compatible; YouTubeNewsStudio/1.0; +https://localhost)',
    accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
  },
});

export type CrawledArticle = { url: string; title: string; rawText: string };
export type CrawlRunReport = {
  runId: number | null;
  status: 'completed' | 'completed_with_errors' | 'skipped';
  activeSources: number;
  dueSources: number;
  skippedSources: number;
  succeededSources: number;
  failedSources: number;
  articlesImported: number;
  startedAt: string;
  completedAt: string;
  results: { sourceId: number; name: string; status: 'ok' | 'failed'; imported: number; error?: string }[];
};

const knownFeedFallbacks: Record<string, string[]> = {
  'kontrafunk.radio': ['https://www.spreaker.com/show/5602119/episodes/feed'],
  'www.kontrafunk.radio': ['https://www.spreaker.com/show/5602119/episodes/feed'],
};

export async function crawlSource(source: Source) {
  try {
    const items = await discoverArticles(source.url);
    const insert = sql.prepare('insert or ignore into articles(sourceId,url,title,rawText,status) values(?,?,?,?,?)');
    let count = 0;
    for (const item of items) {
      if (!item.title || !item.url) continue;
      const r = insert.run(source.id, item.url, item.title.slice(0, 300), item.rawText || item.title, 'new');
      count += Number(r.changes);
    }
    sql.prepare("update sources set lastCrawledAt=?, lastCrawlStatus='ok', lastCrawlError=null where id=?").run(new Date().toISOString(), source.id);
    return count;
  } catch (error) {
    const message = crawlErrorMessage(error, source.url);
    sql.prepare("update sources set lastCrawledAt=?, lastCrawlStatus='failed', lastCrawlError=? where id=?")
      .run(new Date().toISOString(), message, source.id);
    sql.prepare("insert into jobs(articleId,step,status,log) values(null,'crawl','failed',?)")
      .run(`${source.name}: ${message}`);
    throw new Error(message, { cause: error });
  }
}

export async function discoverArticles(url: string, limit = 10): Promise<CrawledArticle[]> {
  for (const feedUrl of feedCandidates(url)) {
    const feedItems = await parser.parseURL(feedUrl).then((feed) => feed.items || []).catch(() => []);
    if (feedItems.length) {
      return uniqueArticles(feedItems.slice(0, limit).map((item) => ({
        url: item.link || feedUrl,
        title: item.title || 'Unbenannter Beitrag',
        rawText: cleanText((item.contentSnippet || item.content || item.summary || '').toString()),
      })));
    }
  }
  return crawlHtml(url, limit);
}

function feedCandidates(url: string) {
  try {
    const parsed = new URL(url);
    return [url, ...(knownFeedFallbacks[parsed.hostname] || [])].filter((candidate, index, all) => all.indexOf(candidate) === index);
  } catch {
    return [url];
  }
}

async function crawlHtml(url: string, limit: number): Promise<CrawledArticle[]> {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const candidates = new Map<string, CrawledArticle>();

  collectJsonLd($, url).forEach((item) => candidates.set(item.url, item));

  const selectors = [
    'article a[href]',
    'main a[href]',
    'h1 a[href], h2 a[href], h3 a[href]',
    '[data-testid*=headline] a[href]',
    '[class*=headline] a[href]',
    '[class*=movieItem] a[href][title]',
    'a[href*="/news/"]',
    'a[href*="/politik/"]',
    'a[href*="/unterhaltung/"]',
    'a[href*="/sport/"]',
    'a[href*="/regional/"]',
    'a[href*="/ratgeber/"]',
  ];

  $(selectors.join(',')).each((_, el) => {
    if (candidates.size >= limit * 3) return;
    const a = $(el);
    const href = a.attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
    const articleUrl = normalizeUrl(href, url);
    const title = extractLinkTitle($, a);
    const containerText = cleanText(a.closest('article, section, li, div').text());
    const rawText = containerText.length > title.length ? containerText : title;
    if (isLikelyArticle(articleUrl, title)) candidates.set(articleUrl, { url: articleUrl, title, rawText });
  });

  return uniqueArticles(Array.from(candidates.values()))
    .sort((a, b) => articleScore(b) - articleScore(a))
    .slice(0, limit);
}

function collectJsonLd($: cheerio.CheerioAPI, baseUrl: string): CrawledArticle[] {
  const out: CrawledArticle[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const nodes = Array.isArray(data) ? data : [data, ...(Array.isArray(data?.['@graph']) ? data['@graph'] : [])];
      for (const node of nodes) {
        const type = Array.isArray(node?.['@type']) ? node['@type'].join(',') : node?.['@type'];
        if (!String(type || '').match(/NewsArticle|Article|Reportage/i)) continue;
        const title = cleanText(node.headline || node.name || '');
        const articleUrl = normalizeUrl(node.url || node.mainEntityOfPage?.['@id'] || baseUrl, baseUrl);
        const rawText = cleanText(node.description || node.articleBody || title);
        if (title) out.push({ url: articleUrl, title, rawText });
      }
    } catch { /* ignore invalid embedded JSON-LD */ }
  });
  return out;
}

async function fetchText(url: string) {
  if (url.startsWith('data:text/html,')) return decodeURIComponent(url.slice('data:text/html,'.length));
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'de-DE,de;q=0.9,en;q=0.7',
    },
  });
  if (!response.ok) throw new Error(`Crawl fehlgeschlagen (${response.status}) für ${url}`);
  return response.text();
}

function crawlErrorMessage(error: unknown, url: string) {
  if (error instanceof Error && error.message) {
    const detail = error.message.slice(0, 400);
    return detail.includes(url) ? detail : `Crawl fehlgeschlagen für ${url}: ${detail}`;
  }
  return `Crawl fehlgeschlagen für ${url}`;
}

function normalizeUrl(href: string, base: string) { return new URL(href, base).toString().split('#')[0]; }
function extractLinkTitle($: cheerio.CheerioAPI, a: cheerio.Cheerio<any>) {
  const direct = cleanText(a.text());
  if (direct.length >= 12) return direct;
  const labelled = cleanText(a.attr('aria-label') || a.attr('title') || '');
  if (labelled.length >= 12) return labelled;
  const imageAlt = cleanText(a.find('img[alt]').first().attr('alt') || '');
  if (imageAlt.length >= 12) return imageAlt;
  return direct;
}
function articleScore(item: CrawledArticle) {
  let score = Math.min(80, item.title.length) + Math.min(120, item.rawText.length / 8);
  if (/\/\d{4}\/|\/artikel\/|\/news\/|\/politik\/|\/sport\//i.test(item.url)) score += 30;
  if (/live|ticker|video|podcast|newsletter/i.test(item.url)) score -= 40;
  return score;
}
function cleanText(value: string) { return value.replace(/\s+/g, ' ').trim().slice(0, 4000); }
function isLikelyArticle(url: string, title: string) { return title.length >= 12 && !/login|abo|newsletter|video|podcast|shop|datenschutz|impressum|kontakt|gewinnspiel/i.test(url); }
function uniqueArticles(items: CrawledArticle[]) { const seen = new Set<string>(); return items.filter((item) => { if (seen.has(item.url)) return false; seen.add(item.url); return true; }); }

export function isSourceDue(source: Pick<Source, 'lastCrawledAt' | 'intervalMinutes'>, now = new Date(), pollingToleranceMs = 5_000) {
  if (!source.lastCrawledAt) return true;
  const last = new Date(source.lastCrawledAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() + Math.max(0, pollingToleranceMs) - last >= Math.max(1, source.intervalMinutes) * 60_000;
}

export function nextCrawlAt(source: Pick<Source, 'lastCrawledAt' | 'intervalMinutes'>) {
  if (!source.lastCrawledAt) return null;
  const last = new Date(source.lastCrawledAt).getTime();
  if (Number.isNaN(last)) return null;
  return new Date(last + Math.max(1, source.intervalMinutes) * 60_000).toISOString();
}

export async function crawlDueSources() {
  return (await crawlDueSourcesDetailed()).articlesImported;
}

export async function crawlDueSourcesDetailed(): Promise<CrawlRunReport> {
  const sources = sql.prepare('select * from sources where active=1').all() as Source[];
  const now = new Date();
  const startedAt = now.toISOString();
  const due = sources.filter((source) => isSourceDue(source, now));
  const running = sql.prepare("select id from crawl_runs where status='running' and datetime(startedAt) > datetime('now','-20 minutes') order by id desc limit 1").get() as { id: number } | undefined;
  if (running) return { runId: running.id, status: 'skipped', activeSources: sources.length, dueSources: due.length, skippedSources: sources.length, succeededSources: 0, failedSources: 0, articlesImported: 0, startedAt, completedAt: new Date().toISOString(), results: [] };

  const created = sql.prepare("insert into crawl_runs(status,activeSources,dueSources,startedAt) values('running',?,?,?)").run(sources.length, due.length, startedAt);
  const runId = Number(created.lastInsertRowid);
  const results: CrawlRunReport['results'] = [];
  let articlesImported = 0;
  for (const source of due) {
    try {
      const imported = await crawlSource(source);
      articlesImported += imported;
      results.push({ sourceId: source.id, name: source.name, status: 'ok', imported });
    } catch (error) {
      results.push({ sourceId: source.id, name: source.name, status: 'failed', imported: 0, error: error instanceof Error ? error.message : 'Unbekannter Crawl-Fehler' });
    }
  }
  const failedSources = results.filter((result) => result.status === 'failed').length;
  const succeededSources = results.length - failedSources;
  const status = failedSources ? 'completed_with_errors' : 'completed';
  const completedAt = new Date().toISOString();
  sql.prepare('update crawl_runs set status=?,succeededSources=?,failedSources=?,articlesImported=?,log=?,completedAt=? where id=?').run(status, succeededSources, failedSources, articlesImported, JSON.stringify(results), completedAt, runId);
  return { runId, status, activeSources: sources.length, dueSources: due.length, skippedSources: sources.length - due.length, succeededSources, failedSources, articlesImported, startedAt, completedAt, results };
}

export function getLatestCrawlRun() {
  return sql.prepare('select * from crawl_runs order by id desc limit 1').get() as {
    id: number; status: string; activeSources: number; dueSources: number; succeededSources: number; failedSources: number; articlesImported: number; log: string | null; startedAt: string; completedAt: string | null;
  } | undefined;
}
