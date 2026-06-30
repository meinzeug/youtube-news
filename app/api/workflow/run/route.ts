import { NextRequest, NextResponse } from 'next/server';
import { crawlDueSources } from '@/lib/news';
import { runPipeline } from '@/lib/pipeline';
import { sql } from '@/lib/db';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const maxArticles = Math.max(1, Math.min(20, Number(body.maxArticles || 1)));
  if (body.crawl) await crawlDueSources();

  const requestedId = Number(body.articleId || 0);
  const rows = requestedId
    ? [{ id: requestedId }]
    : (sql
        .prepare("select id from articles where status in ('new','scripted') order by id desc limit ?")
        .all(maxArticles) as { id: number }[]);

  if (!rows.length) return NextResponse.json({ ok: false, message: 'Keine News gefunden' });

  const videos = [];
  for (const row of rows) videos.push({ articleId: row.id, video: await runPipeline(row.id) });
  return NextResponse.json({ ok: true, count: videos.length, videos });
}
