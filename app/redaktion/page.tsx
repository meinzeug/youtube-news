export const dynamic = 'force-dynamic';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { createEditorialPlan, EDITORIAL_TEAM, getEditorialSnapshot, publishArticleToMagazine, seedEditorialWorkspace, talkToEmployee } from '@/lib/editorial';
import { getAiPolicy, getAiSpend, MODEL_ROUTES } from '@/lib/ai';
import { createTwitchMarker, getTwitchChannel, getTwitchStatus, updateTwitchChannel } from '@/lib/twitch';

async function chat(fd: FormData) {
  'use server';
  const message = String(fd.get('message') || '').trim();
  if (message) await talkToEmployee(String(fd.get('employee') || 'chief'), message);
  revalidatePath('/redaktion');
}

async function makePlan(fd: FormData) {
  'use server';
  const goal = String(fd.get('goal') || '').trim();
  if (goal) await createEditorialPlan(goal);
  revalidatePath('/redaktion');
}

async function addTask(fd: FormData) {
  'use server';
  const title = String(fd.get('title') || '').trim();
  if (!title) return;
  const priority = ['low', 'normal', 'high', 'urgent'].includes(String(fd.get('priority'))) ? String(fd.get('priority')) : 'normal';
  sql.prepare('insert into editorial_tasks(title,description,department,assignee,status,priority,dueAt,createdBy) values(?,?,?,?,?,?,?,?)').run(title, String(fd.get('description') || ''), String(fd.get('department') || 'Redaktion'), String(fd.get('assignee') || 'Mara'), 'backlog', priority, String(fd.get('dueAt') || '') || null, 'CEO');
  revalidatePath('/redaktion');
}

async function moveTask(fd: FormData) {
  'use server';
  const status = ['backlog', 'in_progress', 'review', 'done'].includes(String(fd.get('status'))) ? String(fd.get('status')) : 'backlog';
  sql.prepare('update editorial_tasks set status=?,updatedAt=CURRENT_TIMESTAMP where id=?').run(status, Number(fd.get('id')));
  revalidatePath('/redaktion');
}

async function addCalendarItem(fd: FormData) {
  'use server';
  const title = String(fd.get('title') || '').trim();
  if (title) sql.prepare("insert into editorial_calendar(title,channel,contentType,status,scheduledAt,notes) values(?,?,?,'planned',?,?)").run(title, String(fd.get('channel') || 'YouTube'), String(fd.get('contentType') || 'Video'), String(fd.get('scheduledAt') || '') || null, String(fd.get('notes') || ''));
  revalidatePath('/redaktion');
}

async function publishToWeb(fd: FormData) {
  'use server';
  const slug = await publishArticleToMagazine(Number(fd.get('articleId')));
  redirect(`/magazin/${slug}`);
}

async function updateLive(fd: FormData) {
  'use server';
  await updateTwitchChannel({ title: String(fd.get('title') || ''), gameId: String(fd.get('gameId') || '') || undefined, tags: String(fd.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean) });
  revalidatePath('/redaktion');
}

async function markLive(fd: FormData) {
  'use server';
  await createTwitchMarker(String(fd.get('description') || 'Highlight für YouTube'));
  revalidatePath('/redaktion');
}

type Task = { id: number; title: string; description: string; department: string; assignee: string; status: string; priority: string; dueAt: string | null; articleId: number | null };

export default async function Redaktion() {
  seedEditorialWorkspace();
  const policy = getAiPolicy();
  const spend = getAiSpend();
  const snapshot = getEditorialSnapshot();
  const tasks = sql.prepare('select * from editorial_tasks order by case priority when \'urgent\' then 0 when \'high\' then 1 when \'normal\' then 2 else 3 end, updatedAt desc limit 60').all() as Task[];
  const messages = sql.prepare('select * from editorial_messages order by id desc limit 14').all() as { id: number; author: string; role: string; content: string; model: string | null; costUsd: number; createdAt: string }[];
  const calendar = sql.prepare('select * from editorial_calendar order by scheduledAt is null, scheduledAt asc limit 20').all() as { id: number; title: string; channel: string; contentType: string; status: string; scheduledAt: string | null; notes: string }[];
  const articles = sql.prepare("select id,title,status,videoPath from articles order by updatedAt desc limit 12").all() as { id: number; title: string; status: string; videoPath: string | null }[];
  const twitchStatus = getTwitchStatus();
  const twitch = twitchStatus.connected ? await getTwitchChannel().catch(() => null) : null;
  const columns = [{ key: 'backlog', label: 'Auftragseingang' }, { key: 'in_progress', label: 'In Arbeit' }, { key: 'review', label: 'CEO / Qualitätsfreigabe' }, { key: 'done', label: 'Erledigt' }];

  return <main className="page editorial-page">
    <section className="hero company-hero">
      <div><p className="eyebrow">CEO Command Center</p><h1>{policy.brandName} Redaktion</h1><p>{policy.mission}</p></div>
      <div className="executive-metrics"><span><strong>{snapshot.newArticles}</strong> neue Meldungen</span><span><strong>{snapshot.videosReady}</strong> Videos bereit</span><span><strong>{snapshot.scheduled}</strong> geplant</span><span><strong>${spend.totalUsd.toFixed(3)}</strong> KI / {spend.month}</span></div>
    </section>

    <div className="grid editorial-top-grid">
      <section className="card ceo-chat">
        <div className="card-header"><div><p className="eyebrow">Geschäftsführung</p><h2>Mit dem Team sprechen</h2></div><span className={policy.enabled ? 'badge ok' : 'badge muted-badge'}>{policy.enabled ? 'KI aktiv' : 'KI pausiert'}</span></div>
        <div className="team-strip">{EDITORIAL_TEAM.map((person) => <div className="team-chip" key={person.key}><span>{person.name.slice(0, 1)}</span><div><strong>{person.name}</strong><small>{person.role}</small></div></div>)}</div>
        <div className="conversation">{messages.length ? messages.reverse().map((message) => <article className={`message ${message.author === 'CEO' ? 'message-ceo' : ''}`} key={message.id}><header><strong>{message.author}</strong><span>{message.role}</span></header><p>{message.content}</p>{message.model ? <small>{message.model} · ${Number(message.costUsd || 0).toFixed(4)}</small> : null}</article>) : <p className="muted">Noch kein Gespräch. Gib der Chefredaktion ein Ziel oder sprich direkt mit einem Teammitglied.</p>}</div>
        <form action={chat} className="chat-form"><select name="employee" defaultValue="chief">{EDITORIAL_TEAM.map((person) => <option value={person.key} key={person.key}>{person.name} · {person.role}</option>)}</select><textarea name="message" required rows={3} placeholder="Mara, plane diese Woche drei Videos und einen Twitch-Livestream zum wichtigsten Thema …" /><button>Auftrag senden</button></form>
      </section>

      <section className="card ai-governance">
        <p className="eyebrow">Kostenkontrolle</p><h2>KI-Modellrouting</h2>
        <div className="budget-bar"><span style={{ width: `${Math.min(100, spend.totalUsd / policy.monthlyBudgetUsd * 100)}%` }} /></div><p>${spend.totalUsd.toFixed(4)} von ${policy.monthlyBudgetUsd.toFixed(2)} Monatsbudget · {spend.promptTokens + spend.completionTokens} Tokens</p>
        <div className="model-route-list">{MODEL_ROUTES.map((route) => <div key={route.scenario}><strong>{route.label}</strong><span>{route.model}</span><small>${route.inputPerMillion}/M rein · ${route.outputPerMillion}/M raus</small></div>)}</div>
        <a href="/settings#ai-company">Budgets und Modelle konfigurieren</a>
      </section>
    </div>

    <section className="card plan-generator"><div><p className="eyebrow">KI-Chefredaktion</p><h2>Aus einem CEO-Ziel einen Redaktionsplan erzeugen</h2><p className="muted">Erstellt verantwortete Aufgaben und einen kanalübergreifenden Kalender. Nichts wird ohne die vorhandenen Veröffentlichungsregeln blind publiziert.</p></div><form action={makePlan}><input name="goal" required placeholder="Ziel, Zeitraum, Schwerpunkt und gewünschte Kennzahl" /><button>Plan erstellen</button></form></section>

    <section><div className="section-heading"><div><p className="eyebrow">Workflow</p><h2>Redaktionsboard</h2></div><details><summary>Manuellen Auftrag anlegen</summary><form action={addTask} className="inline-task-form"><input name="title" required placeholder="Auftrag" /><textarea name="description" placeholder="Definition of Done" /><div className="form-split"><select name="assignee">{EDITORIAL_TEAM.map((person) => <option key={person.key}>{person.name}</option>)}</select><select name="priority"><option value="normal">Normal</option><option value="high">Hoch</option><option value="urgent">Dringend</option><option value="low">Niedrig</option></select></div><input name="department" placeholder="Abteilung" defaultValue="Redaktion" /><input name="dueAt" type="datetime-local" /><button>Auftrag anlegen</button></form></details></div>
      <div className="kanban">{columns.map((column) => <div className="kanban-column" key={column.key}><header><strong>{column.label}</strong><span>{tasks.filter((task) => task.status === column.key).length}</span></header>{tasks.filter((task) => task.status === column.key).map((task) => <article className={`task-card priority-${task.priority}`} key={task.id}><div className="task-meta"><span>{task.department}</span><span>{task.priority}</span></div><h3>{task.title}</h3><p>{task.description}</p><small>{task.assignee}{task.dueAt ? ` · ${task.dueAt.replace('T', ' ')}` : ''}</small><form action={moveTask}><input type="hidden" name="id" value={task.id} /><select name="status" defaultValue={task.status}>{columns.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><button className="secondary-button">Verschieben</button></form></article>)}</div>)}</div>
    </section>

    <div className="grid two editorial-lower">
      <section className="card"><div className="card-header"><div><p className="eyebrow">Ausspielung</p><h2>Redaktionskalender</h2></div><span className="badge">{calendar.length}</span></div><div className="calendar-list">{calendar.map((item) => <article key={item.id}><time>{item.scheduledAt ? item.scheduledAt.replace('T', ' ') : 'Termin offen'}</time><div><strong>{item.title}</strong><p>{item.channel} · {item.contentType} · {item.status}</p></div></article>)}</div><details><summary>Termin hinzufügen</summary><form action={addCalendarItem}><input name="title" required placeholder="Titel" /><div className="form-split"><select name="channel"><option>YouTube</option><option>Twitch</option><option>Webmagazin</option><option>Instagram</option><option>TikTok</option><option>Newsletter</option></select><select name="contentType"><option>Video</option><option>Livestream</option><option>Artikel</option><option>Short</option><option>Social Post</option></select></div><input type="datetime-local" name="scheduledAt" /><textarea name="notes" placeholder="Briefing" /><button>Termin planen</button></form></details></section>

      <section className="card twitch-control"><div className="card-header"><div><p className="eyebrow">Live Desk</p><h2>Twitch</h2></div><span className={twitch?.stream ? 'badge live-badge' : twitchStatus.connected ? 'badge ok' : 'badge muted-badge'}>{twitch?.stream ? `LIVE · ${twitch.stream.viewer_count}` : twitchStatus.connected ? 'Verbunden' : 'Nicht verbunden'}</span></div>{twitchStatus.connected ? <><p><strong>{twitch?.channel?.broadcaster_name || twitchStatus.broadcasterName}</strong><br />{twitch?.channel?.title || 'Noch kein Streamtitel geladen'}</p><form action={updateLive}><label>Streamtitel</label><input name="title" required defaultValue={twitch?.channel?.title || ''} /><div className="form-split"><input name="gameId" placeholder="Kategorie/Game-ID optional" /><input name="tags" placeholder="Tags, kommagetrennt" defaultValue={twitch?.channel?.tags?.join(', ') || ''} /></div><button>Live-Metadaten aktualisieren</button></form><form action={markLive}><label>Highlight-Marker</label><input name="description" maxLength={140} defaultValue="Highlight für YouTube-Nachbereitung" /><button className="secondary-button">Marker im laufenden Stream setzen</button></form></> : <><p className="muted">Verbinde Twitch, um Titel, Kategorie, Tags, Live-Status und Highlight-Marker direkt aus der Redaktion zu steuern.</p><a className="button-link" href="/settings">Twitch einrichten</a></>}</section>
    </div>

    <section className="card"><div className="card-header"><div><p className="eyebrow">Owned Media</p><h2>Artikel auf der eigenen Webseite veröffentlichen</h2></div><Link href="/magazin">Webmagazin öffnen</Link></div><div className="publish-list">{articles.map((article) => <article key={article.id}><div><strong>{article.title}</strong><p>{article.status}{article.videoPath ? ' · Video vorhanden' : ''}</p></div><form action={publishToWeb}><input type="hidden" name="articleId" value={article.id} /><button>KI-Webfassung veröffentlichen</button></form></article>)}</div></section>
  </main>;
}
