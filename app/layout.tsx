import Link from 'next/link';
import './style.css';
export const metadata = { title: 'YouTube News Studio', description: 'Automatisierte KI-News-Videos' };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="de"><body><nav><b>YouTube News</b><Link href="/">Dashboard</Link><Link href="/sources">Quellen</Link><Link href="/articles">News</Link><Link href="/studio">Studio</Link><Link href="/settings">Einstellungen</Link></nav>{children}</body></html>}
