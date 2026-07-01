export const dynamic = 'force-dynamic';

import { sql } from '@/lib/db';

const statusLabels: Record<string, string> = {
  new: 'Neu',
  scripted: 'Skript fertig',
  video_ready: 'Video bereit',
  upload_prepared: 'Upload vorbereitet',
};

export default function Home() {
  const stats = {
    sources: sql.prepare('select count(*) c from sources').get() as { c: number },
    activeSources: sql.prepare('select count(*) c from sources where active=1').get() as { c: number },
    articles: sql.prepare('select count(*) c from articles').get() as { c: number },
    queued: sql.prepare("select count(*) c from articles where status in ('new','scripted')").get() as { c: number },
    ready: sql.prepare("select count(*) c from articles where status='video_ready'").get() as { c: number },
    uploaded: sql.prepare("select count(*) c from articles where status='upload_prepared'").get() as { c: number },
    withScript: sql.prepare('select count(*) c from articles where rewrittenText is not null').get() as { c: number },
    withAudio: sql.prepare('select count(*) c from articles where audioPath is not null').get() as { c: number },
  };
  const completion = stats.articles.c ? Math.round(((stats.ready.c + stats.uploaded.c) / stats.articles.c) * 100) : 0;
  const statusRows = sql.prepare('select status, count(*) c from articles group by status order by c desc').all() as { status: string; c: number }[];
  const latest = sql.prepare('select id,title,status,updatedAt,videoPath from articles order by updatedAt desc limit 6').all() as {
    id: number;
    title: string;
    status: string;
    updatedAt: string;
    videoPath: string | null;
  }[];

  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Autonomes Produktions-Dashboard</p>
          <h1>Autonomes YouTube News Studio</h1>
          <p>Crawlt Quellen, schreibt News per OpenRouter um, erzeugt Audio, KI-Bild/Thumbnail, FFmpeg-Video und bereitet YouTube-Uploads vor.</p>
        </div>
        <div className="quick-actions">
          <a className="button-link" href="/studio">Pipeline starten</a>
          <a className="button-link secondary" href="/sources">Quelle hinzufügen</a>
        </div>
      </section>

      <div className="grid stats-grid">
        <div className="card stat"><span>Quellen</span><h2>{stats.sources.c}</h2><p>{stats.activeSources.c} aktiv</p></div>
        <div className="card stat"><span>Artikel</span><h2>{stats.articles.c}</h2><p>{stats.queued.c} in Warteschlange</p></div>
        <div className="card stat"><span>Videos</span><h2>{stats.ready.c}</h2><p>bereit zum Upload</p></div>
        <div className="card stat"><span>Fortschritt</span><h2>{completion}%</h2><div className="progress-meter" aria-label={`Produktionsfortschritt ${completion}%`}><span style={{ width: `${completion}%` }} /></div><p>{stats.withScript.c} Skripte · {stats.withAudio.c} Audios · {stats.uploaded.c} Uploads</p></div>
      </div>

      <div className="grid two">
        <section className="card">
          <h2>Produktionsstatus</h2>
          <div className="status-list">
            {statusRows.length ? statusRows.map((row) => (
              <div className="status-row" key={row.status}>
                <span><span className={`dot ${row.status}`} />{statusLabels[row.status] || row.status}</span>
                <strong>{row.c}</strong>
              </div>
            )) : <p className="muted">Noch keine Artikel vorhanden. Lege zuerst Quellen an und starte einen Crawl.</p>}
          </div>
        </section>

        <section className="card">
          <h2>Zuletzt aktualisiert</h2>
          <div className="activity-list">
            {latest.length ? latest.map((article) => (
              <article key={article.id} className="activity-item">
                <div>
                  <strong>{article.title}</strong>
                  <p className="muted">{article.updatedAt}</p>
                </div>
                {article.videoPath ? <a href={article.videoPath}>Video</a> : <span className="badge">{statusLabels[article.status] || article.status}</span>}
              </article>
            )) : <p className="muted">Noch keine Aktivitäten.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
