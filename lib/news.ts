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

export async function crawlSource(source: Source) {
  const items = await discoverArticles(source.url);
  const insert = sql.prepare('insert or ignore into articles(sourceId,url,title,rawText,status) values(?,?,?,?,?)');
  let count = 0;
  for (const item of items) {
    if (!item.title || !item.url) continue;
    const r = insert.run(source.id, item.url, item.title.slice(0, 300), item.rawText || item.title, 'new');
    count += Number(r.changes);
  }
  sql.prepare('update sources set lastCrawledAt=? where id=?').run(new Date().toISOString(), source.id);
  return count;
}

export async function discoverArticles(url: string, limit = 10): Promise<CrawledArticle[]> {
  const feedItems = await parser.parseURL(url).then((feed) => feed.items || []).catch(() => []);
  if (feedItems.length) {
    return uniqueArticles(feedItems.slice(0, limit).map((item) => ({
      url: item.link || url,
      title: item.title || 'Untitled',
      rawText: cleanText((item.contentSnippet || item.content || item.summary || '').toString()),
    })));
  }
  return crawlHtml(url, limit);
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
    'a[href*="/news/"]',
    'a[href*="/politik/"]',
    'a[href*="/unterhaltung/"]',
    'a[href*="/sport/"]',
  ];

  $(selectors.join(',')).each((_, el) => {
    if (candidates.size >= limit * 3) return;
    const a = $(el);
    const href = a.attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
    const articleUrl = normalizeUrl(href, url);
    const title = cleanText(a.text() || a.attr('aria-label') || a.attr('title') || '');
    const containerText = cleanText(a.closest('article, section, li, div').text());
    const rawText = containerText.length > title.length ? containerText : title;
    if (isLikelyArticle(articleUrl, title)) candidates.set(articleUrl, { url: articleUrl, title, rawText });
  });

  return uniqueArticles(Array.from(candidates.values())).slice(0, limit);
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
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; YouTubeNewsStudio/1.0)', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
  if (!response.ok) throw new Error(`Crawl fehlgeschlagen (${response.status}) für ${url}`);
  return response.text();
}

function normalizeUrl(href: string, base: string) { return new URL(href, base).toString().split('#')[0]; }
function cleanText(value: string) { return value.replace(/\s+/g, ' ').trim().slice(0, 4000); }
function isLikelyArticle(url: string, title: string) { return title.length >= 12 && !/login|abo|newsletter|video|podcast|shop|datenschutz|impressum/i.test(url); }
function uniqueArticles(items: CrawledArticle[]) { const seen = new Set<string>(); return items.filter((item) => { if (seen.has(item.url)) return false; seen.add(item.url); return true; }); }

export function isSourceDue(source: Pick<Source, 'lastCrawledAt' | 'intervalMinutes'>, now = new Date()) {
  if (!source.lastCrawledAt) return true;
  const last = new Date(source.lastCrawledAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= Math.max(1, source.intervalMinutes) * 60_000;
}

export function nextCrawlAt(source: Pick<Source, 'lastCrawledAt' | 'intervalMinutes'>) {
  if (!source.lastCrawledAt) return null;
  const last = new Date(source.lastCrawledAt).getTime();
  if (Number.isNaN(last)) return null;
  return new Date(last + Math.max(1, source.intervalMinutes) * 60_000).toISOString();
}

export async function crawlDueSources() {
  const sources = sql.prepare('select * from sources where active=1').all() as Source[];
  let total = 0;
  const now = new Date();
  for (const s of sources) {
    if (isSourceDue(s, now)) total += await crawlSource(s);
  }
  return total;
}
