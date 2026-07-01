import { NextRequest, NextResponse } from 'next/server';
import { uploadArticleToYoutube } from '@/lib/youtube';

export async function POST(req: NextRequest) {
  const { articleId } = await req.json();
  const result = await uploadArticleToYoutube(Number(articleId));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
