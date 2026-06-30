import { crawlDueSources } from '../lib/news'; import { runPipeline } from '../lib/pipeline'; import { sql } from '../lib/db';
async function main(){ const found=await crawlDueSources(); const rows=sql.prepare("select id from articles where status='new' order by id desc limit 5").all() as {id:number}[]; for(const r of rows) await runPipeline(r.id); console.log(`Crawled ${found}, produced ${rows.length} videos`); }
main().catch(e=>{console.error(e); process.exit(1);});
