export const dynamic = 'force-dynamic';

import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';

const statusLabels: Record<string, string> = {
  all: 'Alle',
  new: 'Neu',
  scripted: 'Skript fertig',
  video_ready: 'Video bereit',
  upload_prepared: 'Upload vorbereitet',
};

async function resetArticle(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  sql.prepare("update articles set status='new', rewrittenText=null, imagePrompt=null, updatedAt=CURRENT_TIMESTAMP where id=?").run(Number(fd.get('id')));
  revalidatePath('/articles');
}

async function prepareUpload(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  const id = Number(fd.get('id'));
  const url = `https://studio.youtube.com/mock-upload/${id}`;
  sql.prepare("update articles set youtubeUrl=?, status='upload_prepared', updatedAt=CURRENT_TIMESTAMP where id=?").run(url, id);
  revalidatePath('/articles');
}

async function deleteArticle(fd: FormData) {
  'use server';
  const { sql } = await import('@/lib/db');
  sql.prepare('delete from articles where id=?').run(Number(fd.get('id')));
  revalidatePath('/articles');
}

export default function Articles({ searchParams }: { searchParams?: { status?: string; q?: string } }) {
  const selectedStatus = searchParams?.status || 'all';
  const query = (searchParams?.q || '').trim();
  const where: string[] = [];
  const params: unknown[] = [];
  if (selectedStatus !== 'all') {
    where.push('status=?');
    params.push(selectedStatus);
  }
  if (query) {
    where.push('(title like ? or rawText like ? or rewrittenText like ?)');
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const rows = sql.prepare(`select * from articles ${where.length ? `where ${where.join(' and ')}` : ''} order by updatedAt desc`).all(...params) as any[];
  const statusRows = sql.prepare('select status, count(*) c from articles group by status').all() as { status: string; c: number }[];
  const counts = new Map(statusRows.map((row) => [row.status, row.c]));

  return (
    <main className="page">
      <div className="page-title"><div><p className="eyebrow">Content-Queue</p><h1>News & Videos</h1></div><span className="badge">{rows.length} Treffer</span></div>

      <form className="toolbar" action="/articles">
        <input name="q" placeholder="Titel oder Text suchen" defaultValue={query} />
        <select name="status" defaultValue={selectedStatus}>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}{value !== 'all' ? ` (${counts.get(value) || 0})` : ''}</option>
          ))}
        </select>
        <button>Filtern</button>
        <a className="button-link secondary" href="/articles">Zurücksetzen</a>
      </form>

      <div className="article-list">
        {rows.map((article) => (
          <article className="card article-card" key={article.id}>
            <div className="card-header">
              <div><h2>{article.title}</h2><p className="muted">#{article.id} · aktualisiert {article.updatedAt}</p></div>
              <span className={`badge status-${article.status}`}>{statusLabels[article.status] || article.status}</span>
            </div>
            <p className="muted clamp">{article.rewrittenText || article.rawText}</p>
            <div className="meta-row">
              <a href={article.url} target="_blank" rel="noreferrer">Quelle öffnen</a>
              {article.videoPath && <a href={article.videoPath}>Video ansehen</a>}
              {article.youtubeUrl && <a href={article.youtubeUrl}>Upload-Link</a>}
            </div>
            <div className="action-row compact">
              {article.videoPath && <form action={prepareUpload}><input type="hidden" name="id" value={article.id} /><button>Upload vorbereiten</button></form>}
              <form action={resetArticle}><input type="hidden" name="id" value={article.id} /><button className="secondary-button">Neu verarbeiten</button></form>
              <form action={deleteArticle}><input type="hidden" name="id" value={article.id} /><button className="danger-button">Löschen</button></form>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
