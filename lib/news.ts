import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { sql, type Source } from './db';
const parser = new Parser();
export async function crawlSource(source: Source){
  const feed = await parser.parseURL(source.url).catch(()=>null);
  const items = feed?.items?.slice(0,10).map(i=>({url:i.link||source.url,title:i.title||'Untitled',rawText:(i.contentSnippet||i.content||'').toString()}));
  const fallback = items?.length ? items : await crawlHtml(source.url);
  const insert = sql.prepare('insert or ignore into articles(sourceId,url,title,rawText,status) values(?,?,?,?,?)');
  let count=0; for(const item of fallback){ const r=insert.run(source.id,item.url,item.title,item.rawText || item.title,'new'); count += Number(r.changes); }
  sql.prepare('update sources set lastCrawledAt=? where id=?').run(new Date().toISOString(), source.id);
  return count;
}
async function crawlHtml(url:string){ const html=await fetch(url).then(r=>r.text()); const $=cheerio.load(html); return $('article a, h1 a, h2 a').slice(0,10).map((_,el)=>{const a=$(el); const href=new URL(a.attr('href')||url,url).toString(); return {url:href,title:a.text().trim()||href,rawText:a.closest('article').text().replace(/\s+/g,' ').trim().slice(0,4000)};}).get(); }

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

export async function crawlDueSources(){
  const sources=sql.prepare('select * from sources where active=1').all() as Source[];
  let total=0;
  const now = new Date();
  for(const s of sources) {
    if (isSourceDue(s, now)) total += await crawlSource(s);
  }
  return total;
}

