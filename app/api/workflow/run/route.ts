import { NextRequest, NextResponse } from 'next/server';
import { crawlDueSourcesDetailed } from '@/lib/news';
import { runPipeline } from '@/lib/pipeline';
import { sql } from '@/lib/db';
import { runNewsdeskTriage } from '@/lib/editorial';
import { runDueCampaigns } from '@/lib/campaigns';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const maxArticles = Math.max(1, Math.min(20, Number(body.maxArticles || 1)));
  const crawl = body.crawl ? await crawlDueSourcesDetailed() : null;
  const editorial = body.editorial === false ? { created: 0, fallback: false } : await runNewsdeskTriage(maxArticles * 2);
  const campaigns = body.campaigns === true ? await runDueCampaigns(maxArticles) : [];

  if (body.campaignOnly) return NextResponse.json({ ok: campaigns.every((run) => run.ok) && (!crawl || crawl.failedSources === 0), crawl, campaigns, editorial });

  const requestedId = Number(body.articleId || 0);
  const rows = requestedId
    ? [{ id: requestedId }]
    : (sql
        .prepare("select id from articles where status in ('new','scripted') order by id desc limit ?")
        .all(maxArticles) as { id: number }[]);

  if (!rows.length) return NextResponse.json({ ok: campaigns.length > 0 || Boolean(crawl), message: 'Keine News gefunden', crawl, editorial, campaigns });

  const videos = [];
  for (const row of rows) videos.push({ articleId: row.id, video: await runPipeline(row.id) });
  return NextResponse.json({ ok: true, count: videos.length, videos, crawl, editorial, campaigns });
}
