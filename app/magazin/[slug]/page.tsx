export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { sql } from '@/lib/db';

export default async function MagazineArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = sql.prepare("select * from brand_posts where slug=? and status='published'").get(slug) as { title: string; excerpt: string; body: string; sourceUrl: string | null; heroImage: string | null; publishedAt: string } | undefined;
  if (!post) notFound();
  return <main className="magazine article-page"><Link href="/magazin">← Alle Beiträge</Link><article><p className="eyebrow">{post.publishedAt?.slice(0, 10)}</p><h1>{post.title}</h1><p className="lead">{post.excerpt}</p>{post.heroImage ? <Image className="article-hero" src={post.heroImage} alt="" width={1200} height={675} unoptimized /> : null}<div className="article-body">{post.body.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>{post.sourceUrl ? <footer>Originalquelle und weitere Hintergründe: <a href={post.sourceUrl} target="_blank" rel="noreferrer">Beitrag öffnen</a></footer> : null}</article></main>;
}
