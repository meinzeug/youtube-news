import { sql, type Source } from '../lib/db';
import { crawlSource } from '../lib/news';

async function main() {
  const url = process.argv[2] || 'https://www.bild.de';
  const name = process.argv[3] || 'Crawl Test';
  sql.prepare('insert into sources(name,url,intervalMinutes,active) values(?,?,?,1) on conflict(url) do update set name=excluded.name, active=1').run(name, url, 30);
  const source = sql.prepare('select * from sources where url=?').get(url) as Source;
  const before = (sql.prepare('select count(*) c from articles where sourceId=?').get(source.id) as { c: number }).c;
  const added = await crawlSource(source);
  const after = (sql.prepare('select count(*) c from articles where sourceId=?').get(source.id) as { c: number }).c;
  const rows = sql.prepare('select title,url from articles where sourceId=? order by id desc limit 5').all(source.id);
  console.log(JSON.stringify({ url, added, before, after, rows }, null, 2));
  if (after < 1) throw new Error(`Keine Artikel für ${url} gefunden`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
