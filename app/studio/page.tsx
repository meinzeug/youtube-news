export const dynamic = 'force-dynamic';
import { getAutomationSettings } from '@/lib/automation';
import { sql } from '@/lib/db';

async function run() {
  'use server';
  const { crawlDueSources } = await import('@/lib/news');
  const { runPipeline } = await import('@/lib/pipeline');
  const { sql } = await import('@/lib/db');
  const { getAutomationSettings } = await import('@/lib/automation');
  const automation = getAutomationSettings();
  if (automation.crawl) await crawlDueSources();
  const rows = sql.prepare("select id from articles where status in ('new','scripted') order by id desc limit ?").all(automation.maxArticles) as { id: number }[];
  for (const row of rows) await runPipeline(row.id);
}

export default function Studio() {
  const automation = getAutomationSettings();
  const queued = (sql.prepare("select count(*) c from articles where status in ('new','scripted')").get() as any).c;
  const latest = sql.prepare('select title,status,updatedAt from articles order by updatedAt desc limit 5').all() as any[];
  return (
    <main className="page">
      <h1>Automations-Studio</h1>
      <div className="grid two">
        <div className="card">
          <p>Startet Crawl + Produktionspipeline mit den Web-Einstellungen.</p>
          <form action={run}><button>Pipeline jetzt starten</button></form>
        </div>
        <div className="card">
          <h2>Status</h2>
          <p><span className="badge">{automation.enabled ? 'aktiv' : 'inaktiv'}</span> alle {automation.intervalMinutes} Minuten · {automation.maxArticles} Artikel/Lauf</p>
          <p>{queued} Artikel warten auf Verarbeitung.</p>
          <a href="/settings">Automation konfigurieren</a>
        </div>
      </div>
      <h2>Letzte Aktivitäten</h2>
      <table><tbody>{latest.map((a) => <tr key={a.title}><td>{a.title}</td><td><span className="badge">{a.status}</span></td><td>{a.updatedAt}</td></tr>)}</tbody></table>
      <div className="grid"><div className="card"><h3>1. Crawl</h3><p>RSS/HTML Quellen werden dedupliziert.</p></div><div className="card"><h3>2. KI Skript</h3><p>OpenRouter schreibt originellen deutschen Sprechertext.</p></div><div className="card"><h3>3. Audio & Bild</h3><p>ElevenLabs oder lokaler FFmpeg-Fallback; SVG-Bildgenerator ohne Binärdateien.</p></div><div className="card"><h3>4. Video & Upload</h3><p>FFmpeg rendert MP4, YouTube Upload-API ist als Integrationspunkt vorbereitet.</p></div></div>
    </main>
  );
}
