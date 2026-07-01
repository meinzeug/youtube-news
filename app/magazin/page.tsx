export const dynamic = 'force-dynamic';
import Link from 'next/link';
import Image from 'next/image';
import { getAiPolicy } from '@/lib/ai';
import { sql } from '@/lib/db';

export default function Magazine() {
  const brand = getAiPolicy();
  const posts = sql.prepare("select slug,title,excerpt,heroImage,publishedAt from brand_posts where status='published' order by publishedAt desc").all() as { slug: string; title: string; excerpt: string; heroImage: string | null; publishedAt: string }[];
  return <main className="magazine"><header className="magazine-header"><p className="eyebrow">{brand.brandName}</p><h1>Nachrichten, Videos und Live-Einordnung</h1><p>{brand.mission}</p><div><a className="button-link" href="https://youtube.com" target="_blank" rel="noreferrer">YouTube</a> <a className="button-link secondary" href="https://twitch.tv" target="_blank" rel="noreferrer">Twitch</a></div></header><section className="magazine-grid">{posts.length ? posts.map((post) => <article className="magazine-card" key={post.slug}>{post.heroImage ? <Image src={post.heroImage} alt="" width={900} height={506} unoptimized /> : <div className="magazine-placeholder">NEWS</div>}<div><time>{post.publishedAt?.slice(0, 10)}</time><h2><Link href={`/magazin/${post.slug}`}>{post.title}</Link></h2><p>{post.excerpt}</p><Link href={`/magazin/${post.slug}`}>Weiterlesen →</Link></div></article>) : <div className="card"><h2>Noch keine Artikel veröffentlicht</h2><p>Die Redaktion kann aus jeder geprüften Meldung eine eigenständige Webfassung veröffentlichen.</p><Link href="/redaktion">Zur Redaktion</Link></div>}</section></main>;
}
