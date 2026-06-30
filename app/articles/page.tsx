export const dynamic = 'force-dynamic';
import { sql } from '@/lib/db';
export default function Articles(){const rows=sql.prepare('select * from articles order by createdAt desc').all() as any[]; return <main className="page"><h1>News & Videos</h1><table><tbody>{rows.map(a=><tr key={a.id}><td>{a.title}</td><td><span className="badge">{a.status}</span></td><td>{a.videoPath && <a href={a.videoPath}>Video</a>}</td></tr>)}</tbody></table></main>}
