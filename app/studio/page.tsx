export const dynamic = 'force-dynamic';
import { getAutomationSettings } from '@/lib/automation';
import { getSettings, sql } from '@/lib/db';
import { getVideoDimensions, normalizeVideoSettings } from '@/lib/video-settings';

async function run(fd: FormData) {
  'use server';
  const { crawlDueSources } = await import('@/lib/news');
  const { runPipeline } = await import('@/lib/pipeline');
  const { sql } = await import('@/lib/db');
  const { getAutomationSettings } = await import('@/lib/automation');
  const automation = getAutomationSettings();
  const maxArticles = Math.max(1, Math.min(20, Number(fd.get('maxArticles') || automation.maxArticles)));
  const shouldCrawl = fd.get('crawl') === 'on';
  if (shouldCrawl) await crawlDueSources();
  const rows = sql.prepare("select id from articles where status in ('new','scripted') order by id desc limit ?").all(maxArticles) as { id: number }[];
  for (const row of rows) await runPipeline(row.id);
}

export default function Studio() {
  const automation = getAutomationSettings();
  const video = normalizeVideoSettings(getSettings() as any);
  const dims = getVideoDimensions(video);
  const queued = (sql.prepare("select count(*) c from articles where status in ('new','scripted')").get() as any).c;
  const latest = sql.prepare('select id,title,status,updatedAt,videoPath from articles order by updatedAt desc limit 5').all() as any[];
  const crawlFailures = sql.prepare("select id,name,lastCrawlError from sources where lastCrawlStatus='failed' order by lastCrawledAt desc limit 3").all() as { id: number; name: string; lastCrawlError: string }[];
  return (
    <main className="page">
      <h1>Automations-Studio</h1>
      <div className="grid two">
        <div className="card">
          <p>Startet die Produktionspipeline direkt aus der Oberfläche. Die Standardwerte kommen aus den Automationseinstellungen.</p>
          <form action={run}>
            <label className="check"><input name="crawl" type="checkbox" defaultChecked={automation.crawl} /> Vorher fällige Quellen crawlen</label>
            <label>Artikel in diesem Lauf</label>
            <input name="maxArticles" type="number" min="1" max="20" defaultValue={automation.maxArticles} />
            <button>Pipeline jetzt starten</button>
          </form>
        </div>
        <div className="card">
          <h2>Status</h2>
          <p><span className="badge">{automation.enabled ? 'aktiv' : 'inaktiv'}</span> alle {automation.intervalMinutes} Minuten · {automation.maxArticles} Artikel/Lauf</p>
          <p>{queued} Artikel warten auf Verarbeitung.</p>
          <p><strong>Video-Preset:</strong> {video.aspectRatio} · {video.resolution} · {dims.width}×{dims.height}</p>
          <p><strong>KI-Regie:</strong> {video.aiEnhancementEnabled ? `${video.aiScriptMode} · ${video.aiTone} · ${video.aiTargetDuration}s` : 'aus'}</p>
          <p>Intro: {video.introMode === 'none' ? 'aus' : video.introText} · Outro: {video.outroMode === 'none' ? 'aus' : video.outroText}</p>
          {crawlFailures.map((failure) => <p className="error" key={failure.id}><strong>{failure.name}:</strong> {failure.lastCrawlError}</p>)}
          <a href="/settings">Automation und Video konfigurieren</a>
        </div>
      </div>
      <h2>Letzte Aktivitäten</h2>
      <table><tbody>{latest.map((a) => <tr key={a.id}><td><a href={`/articles?q=${encodeURIComponent(a.title)}`}>{a.title}</a></td><td><span className="badge">{a.status}</span></td><td>{a.updatedAt}</td><td>{a.videoPath ? <a href={a.videoPath}>Video</a> : '—'}</td></tr>)}</tbody></table>
      <div className="card ai-panel"><h2>OpenRouter KI-Workflow</h2><p>Die Pipeline nutzt strukturierte JSON-Ausgaben für Skript, Thumbnail-Prompt, Titel, Beschreibung, Kapitel und Sicherheitsnotizen. Empfohlene Modelle: {video.aiSuggestedModels}.</p><p className="muted">Ist OpenRouter nicht verbunden oder nicht erreichbar, erstellt die lokale Regel-Engine das Skript ohne erfundene Zusatzinformationen.</p></div><div className="grid"><div className="card"><h3>1. Crawl</h3><p>RSS/HTML Quellen werden dedupliziert.</p></div><div className="card"><h3>2. KI-Regie</h3><p>OpenRouter plant das Konzept; ohne Verbindung übernimmt die lokale Skriptlogik.</p></div><div className="card"><h3>3. Audio & Bild</h3><p>ElevenLabs oder lokale eSpeak-NG-Sprachausgabe; Artikelbilder und lokale Nachrichtengrafiken liefern mehrere Videoszenen.</p></div><div className="card"><h3>4. Video & Upload</h3><p>FFmpeg rendert MP4 inklusive Intro, Outro und Bauchbinde; YouTube lädt je nach Einstellung nur vorbereitet oder per OAuth/Data API hoch.</p></div></div>
    </main>
  );
}
