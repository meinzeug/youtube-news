export const dynamic = 'force-dynamic';

import { revalidatePath } from 'next/cache';
import { sql, type Source } from '@/lib/db';

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

export default function Sources() {
  const sources = sql.prepare('select * from sources order by active desc, id desc').all() as Source[];
  const sourceStats = sql.prepare('select sourceId, count(*) c from articles group by sourceId').all() as { sourceId: number; c: number }[];
  const counts = new Map(sourceStats.map((row) => [row.sourceId, row.c]));

  return (
    <main className="page">
      <div className="page-title"><div><p className="eyebrow">Quellenverwaltung</p><h1>Quellen</h1></div><span className="badge">{sources.length} angelegt</span></div>
      <form action={addSource} className="stacked-form">
        <h2>Neue RSS- oder Webseiten-URL anlegen</h2>
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
            <p className="muted">Zuletzt gecrawlt: {source.lastCrawledAt || 'noch nie'}</p>
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
