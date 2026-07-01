export const dynamic = 'force-dynamic';

import { revalidatePath } from 'next/cache';
import { sql, type Source } from '@/lib/db';
import { discoverArticles, getLatestCrawlRun, isSourceDue, nextCrawlAt } from '@/lib/news';
import { sourcePresets } from '@/lib/source-presets';
import { getAutomationStatus } from '@/lib/automation';

async function addSource(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  const name = String(fd.get('name') || '').trim();
  const url = String(fd.get('url') || '').trim();
  const interval = Math.max(1, Math.min(1440, Number(fd.get('intervalMinutes') || 30)));
  if (!name || !url) return;
  sql.prepare('insert into sources(name,url,intervalMinutes,active) values(?,?,?,1) on conflict(url) do update set name=excluded.name, intervalMinutes=excluded.intervalMinutes, active=1').run(
    name,
    url,
    interval,
  );
  revalidatePath('/sources');
}

async function addPresetSource(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  const { sourcePresets } = await import('@/lib/source-presets');
  const presetUrl = String(fd.get('url') || '');
  const preset = sourcePresets.find((item) => item.url === presetUrl);
  if (!preset) return;
  sql.prepare('insert into sources(name,url,intervalMinutes,active) values(?,?,?,1) on conflict(url) do update set name=excluded.name, intervalMinutes=excluded.intervalMinutes, active=1').run(preset.name, preset.url, preset.intervalMinutes);
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
  if (source) await crawlSource(source).catch(() => undefined);
  revalidatePath('/sources');
}

async function crawlAllDueSources() {
  'use server';
  const { crawlDueSourcesDetailed } = await import('@/lib/news');
  await crawlDueSourcesDetailed();
  revalidatePath('/sources');
  revalidatePath('/');
}

type SourcesSearchParams = { q?: string; state?: string; previewUrl?: string };

export default async function Sources({ searchParams }: { searchParams: Promise<SourcesSearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const query = (resolvedSearchParams.q || '').trim();
  const selectedState = resolvedSearchParams.state || 'all';
  const previewUrl = (resolvedSearchParams.previewUrl || '').trim();
  let preview: { url: string; title: string; rawText: string }[] = [];
  let previewError = '';
  if (previewUrl) {
    try {
      preview = await discoverArticles(previewUrl, 6);
    } catch (error) {
      previewError = error instanceof Error ? error.message : 'Crawl-Vorschau fehlgeschlagen';
    }
  }
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
  const automation = await getAutomationStatus();
  const latestCrawl = getLatestCrawlRun();
  const crawlHistory = sql.prepare('select id,status,dueSources,succeededSources,failedSources,articlesImported,startedAt,completedAt from crawl_runs order by id desc limit 6').all() as { id: number; status: string; dueSources: number; succeededSources: number; failedSources: number; articlesImported: number; startedAt: string; completedAt: string | null }[];
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
      <section className="card crawl-operations">
        <div className="card-header"><div><p className="eyebrow">Automatische Nachrichtensuche</p><h2>Crawler-Betrieb</h2></div><div className="automation-health"><span className={automation.enabled ? 'badge ok' : 'badge muted-badge'}>Automation {automation.enabled ? 'aktiv' : 'aus'}</span><span className={automation.userCrontabActive ? 'badge ok' : 'badge status-upload_failed'}>Cron {automation.userCrontabActive ? 'läuft' : 'fehlt'}</span></div></div>
        <div className="crawl-kpis"><div><strong>{latestCrawl?.articlesImported || 0}</strong><span>zuletzt importiert</span></div><div><strong>{latestCrawl?.dueSources || 0}</strong><span>Quellen geprüft</span></div><div><strong>{latestCrawl?.failedSources || 0}</strong><span>Fehler</span></div><div><strong>{latestCrawl?.completedAt ? latestCrawl.completedAt.replace('T', ' ').slice(0, 19) : '—'}</strong><span>letzter Lauf UTC</span></div></div>
        <p className="muted">Der lokale Cron prüft alle {automation.intervalMinutes} Minuten, welche aktiven Quellen ihr individuelles Intervall erreicht haben. Letzter Status: {latestCrawl?.status || 'noch kein protokollierter Lauf'}.</p>
        <form action={crawlAllDueSources} className="inline-crawl-action"><button>Alle fälligen Quellen jetzt prüfen</button></form>
        <details><summary>Letzte Crawl-Läufe</summary><div className="crawl-history">{crawlHistory.map((run) => <div key={run.id}><span>#{run.id} · {run.startedAt.replace('T', ' ').slice(0, 19)}</span><strong>{run.articlesImported} neu</strong><span>{run.succeededSources}/{run.dueSources} erfolgreich</span><span className={run.failedSources ? 'error-text' : ''}>{run.failedSources} Fehler</span></div>)}</div></details>
      </section>
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
      <form className="stacked-form preview-form" action="/sources">
        <h2>Crawler-Vorschau testen</h2>
        <p className="muted">Prüfe eine Startseite oder einen Feed, bevor du ihn dauerhaft speicherst. Die Vorschau importiert nichts und zeigt die Top-Kandidaten des Crawlers.</p>
        <div className="preview-grid">
          <input name="previewUrl" placeholder="https://www.bild.de" type="url" defaultValue={previewUrl} required />
          <button>Vorschau laden</button>
        </div>
        {previewError && <p className="error">{previewError}</p>}
        {previewUrl && !previewError && (
          <div className="crawl-preview">
            <div className="card-header"><strong>{preview.length} gefundene Artikel</strong><span className="badge muted-badge">Nur Vorschau</span></div>
            {preview.length ? <ol>{preview.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><p className="muted clamp">{item.rawText || item.url}</p></li>)}</ol> : <p className="muted">Keine Artikel erkannt. Versuche eine RSS-URL oder eine andere Ressortseite.</p>}
          </div>
        )}
      </form>

      <section className="card preset-panel">
        <div className="card-header"><div><h2>Quellen-Schnellstart</h2><p className="muted">Füge bewährte Beispielquellen mit einem Klick hinzu oder reaktiviere sie. Ideal für neue Installationen und Crawl-Tests.</p></div><span className="badge muted-badge">{sourcePresets.length} Presets</span></div>
        <div className="preset-grid">
          {sourcePresets.map((preset) => {
            const installed = sources.some((source) => source.url === preset.url);
            return (
              <form key={preset.url} action={addPresetSource} className="preset-card">
                <input type="hidden" name="url" value={preset.url} />
                <div className="card-header"><strong>{preset.name}</strong><span className="badge">{preset.category}</span></div>
                <p className="muted">{preset.description}</p>
                <p className="muted url-text">{preset.url}</p>
                <button>{installed ? 'Aktualisieren / aktivieren' : 'Quelle hinzufügen'}</button>
              </form>
            );
          })}
        </div>
      </section>

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
            {source.lastCrawlStatus === 'failed' && source.lastCrawlError ? <p className="error">Letzter Crawl fehlgeschlagen: {source.lastCrawlError}</p> : null}
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
