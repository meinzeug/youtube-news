export const dynamic = 'force-dynamic';

import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';

const statusLabels: Record<string, string> = {
  all: 'Alle',
  new: 'Neu',
  scripted: 'Skript fertig',
  video_ready: 'Video bereit',
  upload_prepared: 'Upload vorbereitet',
  uploaded: 'Hochgeladen',
  upload_failed: 'Upload fehlgeschlagen',
};

const sortOptions: Record<string, string> = {
  updated_desc: 'Zuletzt aktualisiert',
  created_desc: 'Neueste zuerst',
  title_asc: 'Titel A-Z',
  status_asc: 'Status',
};

const sortSql: Record<string, string> = {
  updated_desc: 'articles.updatedAt desc',
  created_desc: 'articles.createdAt desc',
  title_asc: 'articles.title collate nocase asc',
  status_asc: 'articles.status asc, articles.updatedAt desc',
};

type ArticleRow = {
  id: number;
  sourceId: number | null;
  sourceName: string | null;
  url: string;
  title: string;
  rawText: string;
  rewrittenText: string | null;
  audioPath: string | null;
  imagePath: string | null;
  videoPath: string | null;
  youtubeUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

async function resetArticle(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  sql.prepare("update articles set status='new', rewrittenText=null, videoDescription=null, imagePrompt=null, updatedAt=CURRENT_TIMESTAMP where id=?").run(Number(fd.get('id')));
  revalidatePath('/articles');
}

async function generateVideo(fd: FormData) {
  'use server';
  const { runPipeline } = await import('@/lib/pipeline');
  await runPipeline(Number(fd.get('id')));
  revalidatePath('/articles');
  revalidatePath('/studio');
}

async function prepareUpload(fd: FormData) {
  'use server';
  const id = Number(fd.get('id'));
  const { uploadArticleToYoutube } = await import('@/lib/youtube');
  await uploadArticleToYoutube(id);
  revalidatePath('/articles');
}

async function deleteArticle(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  sql.prepare('delete from articles where id=?').run(Number(fd.get('id')));
  revalidatePath('/articles');
}

async function bulkUpdate(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  const ids = fd.getAll('ids').map(Number).filter((id) => Number.isInteger(id) && id > 0);
  const action = String(fd.get('bulkAction') || '');
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  if (action === 'reset') {
    sql.prepare(`update articles set status='new', rewrittenText=null, videoDescription=null, imagePrompt=null, updatedAt=CURRENT_TIMESTAMP where id in (${placeholders})`).run(...ids);
  }
  if (action === 'prepare') {
    const readyRows = sql.prepare(`select id from articles where id in (${placeholders}) and videoPath is not null`).all(...ids) as { id: number }[];
    const { uploadArticleToYoutube } = await import('@/lib/youtube');
    for (const row of readyRows) await uploadArticleToYoutube(row.id);
  }
  if (action === 'delete') {
    sql.prepare(`delete from articles where id in (${placeholders})`).run(...ids);
  }
  revalidatePath('/articles');
}

type ArticlesSearchParams = { status?: string; q?: string; source?: string; sort?: string };

export default async function Articles({ searchParams }: { searchParams: Promise<ArticlesSearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const selectedStatus = resolvedSearchParams.status || 'all';
  const selectedSource = resolvedSearchParams.source || 'all';
  const selectedSort = sortSql[resolvedSearchParams.sort || ''] ? resolvedSearchParams.sort || 'updated_desc' : 'updated_desc';
  const query = (resolvedSearchParams.q || '').trim();
  const where: string[] = [];
  const params: unknown[] = [];
  if (selectedStatus !== 'all') {
    where.push('articles.status=?');
    params.push(selectedStatus);
  }
  if (selectedSource !== 'all') {
    where.push('articles.sourceId=?');
    params.push(Number(selectedSource));
  }
  if (query) {
    where.push('(articles.title like ? or articles.rawText like ? or articles.rewrittenText like ? or sources.name like ?)');
    params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
  }
  const whereClause = where.length ? `where ${where.join(' and ')}` : '';
  const rows = sql.prepare(`select articles.*, sources.name as sourceName from articles left join sources on sources.id=articles.sourceId ${whereClause} order by ${sortSql[selectedSort]}`).all(...params) as ArticleRow[];
  const statusRows = sql.prepare('select status, count(*) c from articles group by status').all() as { status: string; c: number }[];
  const sources = sql.prepare('select id,name from sources order by name collate nocase').all() as { id: number; name: string }[];
  const counts = new Map(statusRows.map((row) => [row.status, row.c]));
  const socialRows = sql.prepare('select articleId, channel, status, createdAt from social_posts order by createdAt desc limit 100').all() as { articleId: number; channel: string; status: string; createdAt: string }[];
  const socialByArticle = new Map<number, typeof socialRows>();
  socialRows.forEach((post) => {
    const list = socialByArticle.get(post.articleId) || [];
    if (list.length < 5) {
      list.push(post);
      socialByArticle.set(post.articleId, list);
    }
  });
  const readySelectionCount = rows.filter((article) => article.videoPath).length;
  const totalWords = rows.reduce((sum, article) => sum + countWords(article.rewrittenText || article.rawText), 0);
  const estimatedMinutes = Math.max(1, Math.ceil(totalWords / 155));

  return (
    <main className="page">
      <div className="page-title"><div><p className="eyebrow">Content-Queue</p><h1>News & Videos</h1></div><span className="badge">{rows.length} Treffer · ca. {estimatedMinutes} Min. Material</span></div>

      <form className="toolbar enhanced" action="/articles">
        <input name="q" placeholder="Titel, Text oder Quelle suchen" defaultValue={query} />
        <select name="status" defaultValue={selectedStatus} aria-label="Status filtern">
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}{value !== 'all' ? ` (${counts.get(value) || 0})` : ''}</option>
          ))}
        </select>
        <select name="source" defaultValue={selectedSource} aria-label="Quelle filtern">
          <option value="all">Alle Quellen</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
        <select name="sort" defaultValue={selectedSort} aria-label="Sortierung">
          {Object.entries(sortOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button>Filtern</button>
        <a className="button-link secondary" href="/articles">Zurücksetzen</a>
      </form>

      <div className="bulk-panel">
        <form id="bulk-actions" className="bulk-panel__form" action={bulkUpdate}>
        <div className="bulk-panel__header">
          <div><strong>Sammelaktionen</strong><p className="muted">Mehrere Artikel unten markieren und gemeinsam verarbeiten.</p></div>
          <span className="badge muted-badge">{readySelectionCount} mit Video</span>
        </div>
        <div className="bulk-panel__controls">
          <select name="bulkAction" defaultValue="reset" aria-label="Sammelaktion wählen">
            <option value="reset">Neu verarbeiten</option>
            <option value="prepare">YouTube Upload/Vorbereitung für Artikel mit Video</option>
            <option value="delete">Markierte löschen</option>
          </select>
          <button>Auf markierte anwenden</button>
        </div>
        </form>

        <div className="article-list">
          {rows.length ? rows.map((article) => (
            <article className="card article-card selectable" key={article.id}>
              <label className="select-row"><input form="bulk-actions" type="checkbox" name="ids" value={article.id} /><span>Artikel auswählen</span></label>
              <div className="card-header">
                <div><h2>{article.title}</h2><p className="muted">#{article.id} · {article.sourceName || 'Unbekannte Quelle'} · aktualisiert {article.updatedAt}</p></div>
                <span className={`badge status-${article.status}`}>{statusLabels[article.status] || article.status}</span>
              </div>
              <p className="muted clamp">{article.rewrittenText || article.rawText}</p>
              <details className="article-details"><summary>Produktionsdetails anzeigen</summary><dl><dt>Erstellt</dt><dd>{article.createdAt}</dd><dt>Quelle</dt><dd>{article.sourceName || 'Nicht zugeordnet'}</dd><dt>Status</dt><dd>{statusLabels[article.status] || article.status}</dd><dt>Rohtext</dt><dd>{article.rawText.length} Zeichen · {countWords(article.rawText)} Wörter</dd><dt>Sprechzeit</dt><dd>ca. {estimateReadingTime(article.rewrittenText || article.rawText)}</dd><dt>Skript</dt><dd>{article.rewrittenText ? `${article.rewrittenText.length} Zeichen` : 'noch nicht erzeugt'}</dd><dt>Assets</dt><dd>{[article.audioPath && 'Audio', article.imagePath && 'Bild', article.videoPath && 'Video'].filter(Boolean).join(', ') || 'keine'}</dd><dt>Social Posts</dt><dd>{(socialByArticle.get(article.id) || []).length ? (socialByArticle.get(article.id) || []).map((post) => `${post.channel}: ${post.status}`).join(' · ') : 'noch keine Verteilung'}</dd></dl></details>
              <div className="meta-row">
                <a href={article.url} target="_blank" rel="noreferrer">Quelle öffnen</a>
                {article.videoPath && <a href={article.videoPath}>Video ansehen</a>}
                {article.youtubeUrl && <a href={article.youtubeUrl}>Upload-Link</a>}
              </div>
              <div className="action-row compact">
                <form action={generateVideo}><input type="hidden" name="id" value={article.id} /><button>{article.videoPath ? 'Video neu erzeugen' : 'Video erzeugen'}</button></form>
                {article.videoPath && <form action={prepareUpload}><input type="hidden" name="id" value={article.id} /><button>YouTube Upload</button></form>}
                <form action={resetArticle}><input type="hidden" name="id" value={article.id} /><button className="secondary-button">Neu verarbeiten</button></form>
                <form action={deleteArticle}><input type="hidden" name="id" value={article.id} /><button className="danger-button">Löschen</button></form>
              </div>
            </article>
          )) : <p className="card muted">Keine Artikel passen zu den aktuellen Filtern.</p>}
        </div>
      </div>
    </main>
  );
}

function countWords(value: string) { return value.trim() ? value.trim().split(/\s+/).length : 0; }
function estimateReadingTime(value: string) { const words = countWords(value); const minutes = Math.max(1, Math.ceil(words / 155)); return `${minutes} Min. bei 155 WPM`; }
