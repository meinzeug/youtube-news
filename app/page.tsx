export const dynamic = 'force-dynamic';

import { sql } from '@/lib/db';
import { getAiPolicy, getAiSpend } from '@/lib/ai';
import { EDITORIAL_TEAM, getEditorialSnapshot, seedEditorialWorkspace } from '@/lib/editorial';
import { getTwitchStatus } from '@/lib/twitch';

const statusLabels: Record<string, string> = {
  new: 'Neu',
  scripted: 'Skript fertig',
  video_ready: 'Video bereit',
  upload_prepared: 'Upload vorbereitet',
  uploaded: 'Hochgeladen',
  upload_failed: 'Upload fehlgeschlagen',
};

export default function Home() {
  seedEditorialWorkspace();
  const company = getAiPolicy();
  const aiSpend = getAiSpend();
  const editorial = getEditorialSnapshot();
  const twitch = getTwitchStatus();
  const stats = {
    sources: sql.prepare('select count(*) c from sources').get() as { c: number },
    activeSources: sql.prepare('select count(*) c from sources where active=1').get() as { c: number },
    articles: sql.prepare('select count(*) c from articles').get() as { c: number },
    queued: sql.prepare("select count(*) c from articles where status in ('new','scripted')").get() as { c: number },
    ready: sql.prepare("select count(*) c from articles where status='video_ready'").get() as { c: number },
    uploaded: sql.prepare("select count(*) c from articles where status in ('upload_prepared','uploaded')").get() as { c: number },
    withScript: sql.prepare('select count(*) c from articles where rewrittenText is not null').get() as { c: number },
    withAudio: sql.prepare('select count(*) c from articles where audioPath is not null').get() as { c: number },
  };
  const completion = stats.articles.c ? Math.round(((stats.ready.c + stats.uploaded.c) / stats.articles.c) * 100) : 0;
  const latest = sql.prepare('select id,title,status,updatedAt,videoPath from articles order by updatedAt desc limit 6').all() as {
    id: number;
    title: string;
    status: string;
    updatedAt: string;
    videoPath: string | null;
  }[];
  const priorityTasks = sql.prepare("select id,title,assignee,priority,status from editorial_tasks where status!='done' order by case priority when 'urgent' then 0 when 'high' then 1 else 2 end,updatedAt desc limit 5").all() as { id: number; title: string; assignee: string; priority: string; status: string }[];
  const nextEvents = sql.prepare("select title,channel,contentType,scheduledAt from editorial_calendar where status='planned' order by scheduledAt is null,scheduledAt limit 4").all() as { title: string; channel: string; contentType: string; scheduledAt: string | null }[];

  return (
    <main className="page">
      <section className="hero executive-hero">
        <div>
          <p className="eyebrow">Executive Overview</p>
          <h1>Guten Tag, CEO.</h1>
          <p>{company.brandName} wird über dieses Cockpit als integrierte Medienmarke geführt: YouTube, Twitch, Web und Social aus einer Redaktion.</p>
        </div>
        <div className="quick-actions">
          <a className="button-link" href="/redaktion">Team beauftragen</a>
          <a className="button-link secondary" href="/studio">Produktion starten</a>
        </div>
      </section>

      <div className="grid stats-grid">
        <div className="card stat"><span>News-Pipeline</span><h2>{stats.articles.c}</h2><p>{stats.queued.c} warten · {stats.activeSources.c} Quellen aktiv</p></div>
        <div className="card stat"><span>Produktion</span><h2>{stats.ready.c}</h2><p>Videos bereit · {stats.uploaded.c} veröffentlicht</p></div>
        <div className="card stat"><span>Redaktion</span><h2>{Number(editorial.tasks.in_progress || 0)}</h2><p>in Arbeit · {Number(editorial.tasks.review || 0)} zur Freigabe</p></div>
        <div className="card stat"><span>KI-Budget</span><h2>${aiSpend.totalUsd.toFixed(2)}</h2><div className="progress-meter"><span style={{ width: `${Math.min(100, aiSpend.totalUsd / company.monthlyBudgetUsd * 100)}%` }} /></div><p>von ${company.monthlyBudgetUsd.toFixed(2)} im {aiSpend.month}</p></div>
      </div>

      <div className="grid dashboard-grid">
        <section className="card">
          <div className="card-header"><div><p className="eyebrow">Prioritäten</p><h2>Auf dem Tisch</h2></div><a href="/redaktion">Board öffnen</a></div>
          <div className="priority-list">{priorityTasks.length ? priorityTasks.map((task) => <article key={task.id}><span className={`priority-dot ${task.priority}`} /><div><strong>{task.title}</strong><p>{task.assignee} · {task.status}</p></div><span className="badge muted-badge">{task.priority}</span></article>) : <p className="muted">Keine offenen Aufträge.</p>}</div>
        </section>

        <section className="card">
          <div className="card-header"><div><p className="eyebrow">Kalender</p><h2>Nächste Ausspielung</h2></div><a href="/redaktion">Planen</a></div>
          <div className="calendar-list compact">{nextEvents.length ? nextEvents.map((event, index) => <article key={`${event.title}-${index}`}><time>{event.scheduledAt ? event.scheduledAt.slice(5, 16).replace('T', ' · ') : 'offen'}</time><div><strong>{event.title}</strong><p>{event.channel} · {event.contentType}</p></div></article>) : <p className="muted">Noch keine Veröffentlichungen geplant.</p>}</div>
        </section>
      </div>

      <div className="grid dashboard-grid">
        <section className="card"><div className="card-header"><div><p className="eyebrow">Newsroom</p><h2>Letzte Inhalte</h2></div><span>{completion}% produziert</span></div><div className="activity-list">{latest.length ? latest.map((article) => <article key={article.id} className="activity-item"><div><strong>{article.title}</strong><p className="muted">{article.updatedAt}</p></div>{article.videoPath ? <a href={article.videoPath}>Video</a> : <span className="badge">{statusLabels[article.status] || article.status}</span>}</article>) : <p className="muted">Noch keine Aktivitäten.</p>}</div></section>
        <section className="card"><div className="card-header"><div><p className="eyebrow">Organisation</p><h2>KI-Team</h2></div><span className="badge ok">{company.enabled ? 'aktiv' : 'pausiert'}</span></div><div className="team-overview">{EDITORIAL_TEAM.map((member) => <div key={member.key}><span>{member.name[0]}</span><div><strong>{member.name}</strong><small>{member.role}</small></div></div>)}</div><div className="channel-health"><span><i className="youtube-dot" />YouTube · {stats.ready.c} bereit</span><span><i className="twitch-dot" />Twitch · {twitch.connected ? 'verbunden' : 'offen'}</span><span><i className="web-dot" />Web · {editorial.publishedPosts} Artikel</span></div></section>
      </div>
    </main>
  );
}
