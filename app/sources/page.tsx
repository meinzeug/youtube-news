export const dynamic = 'force-dynamic';

import { revalidatePath } from 'next/cache';
import { sql, type Source } from '@/lib/db';
import { isSourceDue, nextCrawlAt } from '@/lib/news';

async function addSource(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  sql.prepare('insert into sources(name,url,intervalMinutes,active) values(?,?,?,1)').run(
    String(fd.get('name') || '').trim(),
    String(fd.get('url') || '').trim(),
    Number(fd.get('intervalMinutes') || 30),
  );
  revalidatePath('/sources');
}

async function updateSource(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  const id = Number(fd.get('id'));
  const name = String(fd.get('name') || '').trim();
  const url = String(fd.get('url') || '').trim();
  const interval = Math.max(1, Math.min(1440, Number(fd.get('intervalMinutes') || 30)));
  if (id && name && url) {
    sql.prepare('update sources set name=?, url=?, intervalMinutes=? where id=?').run(name, url, interval, id);
  }
  revalidatePath('/sources');
}

async function toggleSource(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  sql.prepare('update sources set active = case active when 1 then 0 else 1 end where id=?').run(Number(fd.get('id')));
  revalidatePath('/sources');
}

async function deleteSource(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  sql.prepare('delete from sources where id=?').run(Number(fd.get('id')));
  revalidatePath('/sources');
}

async function crawlSingleSource(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  const { crawlSource } = await import('@/lib/news');
  const source = sql.prepare('select * from sources where id=?').get(Number(fd.get('id'))) as Source | undefined;
  if (source) await crawlSource(source);
  revalidatePath('/sources');
}

export default function Sources({ searchParams }: { searchParams?: { q?: string; state?: string } }) {
  const query = (searchParams?.q || '').trim();
  const selectedState = searchParams?.state || 'all';
  const sourceParams: unknown[] = [];
  const where: string[] = [];
  if (query) {
    where.push('(name like ? or url like ?)');
    sourceParams.push(`%${query}%`, `%${query}%`);
  }
  if (selectedState === 'active') where.push('active=1');
  if (selectedState === 'paused') where.push('active=0');
  const sources = sql.prepare(`select * from sources ${where.length ? `where ${where.join(' and ')}` : ''} order by active desc, id desc`).all(...sourceParams) as Source[];
  const sourceStats = sql.prepare('select sourceId, count(*) c, max(updatedAt) latest from articles group by sourceId').all() as { sourceId: number; c: number; latest: string | null }[];
  const latestArticles = sql.prepare('select id, sourceId, title, status, updatedAt from articles order by updatedAt desc limit 24').all() as { id: number; sourceId: number; title: string; status: string; updatedAt: string }[];
  const counts = new Map(sourceStats.map((row) => [row.sourceId, row.c]));
  const latestBySource = new Map(sourceStats.map((row) => [row.sourceId, row.latest]));
  const activeCount = sources.filter((source) => source.active).length;
  const dueCount = sources.filter((source) => source.active && isSourceDue(source)).length;
  const articlesBySource = new Map<number, typeof latestArticles>();
  latestArticles.forEach((article) => {
    if (!article.sourceId) return;
    const list = articlesBySource.get(article.sourceId) || [];
    if (list.length < 3) {
      list.push(article);
      articlesBySource.set(article.sourceId, list);
    }
  });

  return (
    <main className="page">
      <div className="page-title"><div><p className="eyebrow">Quellenverwaltung</p><h1>Quellen</h1></div><span className="badge">{sources.length} Treffer · {activeCount} aktiv · {dueCount} fällig</span></div>
      <form className="toolbar sources-toolbar" action="/sources">
        <input name="q" placeholder="Quelle oder URL suchen" defaultValue={query} />
        <select name="state" defaultValue={selectedState} aria-label="Quellenstatus filtern">
          <option value="all">Alle Quellen</option>
          <option value="active">Nur aktive</option>
          <option value="paused">Nur pausierte</option>
        </select>
        <button>Filtern</button>
        <a className="button-link secondary" href="/sources">Zurücksetzen</a>
      </form>
      <form action={addSource} className="stacked-form">
        <h2>Neue RSS- oder Webseiten-URL anlegen</h2>
        <p className="muted">Tipp: Der Crawler erkennt RSS-Feeds, JSON-LD-NewsArticle-Daten und typische Artikel-Links auf HTML-Startseiten. Du kannst daher z. B. direkt <code>https://www.bild.de</code> testen.</p>
        <div className="form-grid">
          <input name="name" placeholder="Quelle" required />
          <input name="url" placeholder="https://.../rss" type="url" required />
          <input name="intervalMinutes" type="number" min="1" max="1440" defaultValue="30" aria-label="Intervall in Minuten" />
        </div>
        <button>Quelle speichern</button>
      </form>

      <div className="grid">
        {sources.map((source) => (
          <div className={`card source-card ${source.active ? '' : 'is-muted'}`} key={source.id}>
            <div className="card-header"><h3>{source.name}</h3><span className="badge">{source.active ? 'aktiv' : 'pausiert'}</span></div>
            <p className="muted url-text">{source.url}</p>
            <p>{counts.get(source.id) || 0} Artikel · alle {source.intervalMinutes} min</p>
            <p className="muted">Letzter Artikel: {latestBySource.get(source.id) || 'noch keiner'}</p>
            <div className="automation-health">
              <span className={isSourceDue(source) ? 'badge ok' : 'badge muted-badge'}>{isSourceDue(source) ? 'fällig' : 'geplant'}</span>
              <span className="badge muted-badge">Nächster Crawl: {nextCrawlAt(source) || 'sofort'}</span>
            </div>
            <p className="muted">Zuletzt gecrawlt: {source.lastCrawledAt || 'noch nie'}</p>
            <div className="source-latest">
              <strong>Letzte Artikel</strong>
              {(articlesBySource.get(source.id) || []).length ? (
                <ul>
                  {(articlesBySource.get(source.id) || []).map((article) => <li key={article.id}><a href={`/articles?q=${encodeURIComponent(article.title)}`}>{article.title}</a><span className="badge muted-badge">{article.status}</span></li>)}
                </ul>
              ) : <p className="muted">Noch keine Artikel. Nutze „Jetzt crawlen“ zum Testen.</p>}
            </div>
            <details className="article-details"><summary>Quelle bearbeiten</summary><form action={updateSource} className="inline-edit"><input type="hidden" name="id" value={source.id} /><label>Name</label><input name="name" defaultValue={source.name} required /><label>URL</label><input name="url" type="url" defaultValue={source.url} required /><label>Intervall in Minuten</label><input name="intervalMinutes" type="number" min="1" max="1440" defaultValue={source.intervalMinutes} /><button>Änderungen speichern</button></form></details>
            <div className="action-row">
              <form action={crawlSingleSource}><input type="hidden" name="id" value={source.id} /><button>Jetzt crawlen</button></form>
              <form action={toggleSource}><input type="hidden" name="id" value={source.id} /><button className="secondary-button">{source.active ? 'Pausieren' : 'Aktivieren'}</button></form>
              <form action={deleteSource}><input type="hidden" name="id" value={source.id} /><button className="danger-button">Löschen</button></form>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
