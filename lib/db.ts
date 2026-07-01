import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'youtube-news.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, intervalMinutes INTEGER DEFAULT 30, active INTEGER DEFAULT 1, lastCrawledAt TEXT);
CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY AUTOINCREMENT, sourceId INTEGER, url TEXT UNIQUE, title TEXT NOT NULL, rawText TEXT NOT NULL, rewrittenText TEXT, imagePrompt TEXT, audioPath TEXT, imagePath TEXT, videoPath TEXT, youtubeUrl TEXT, status TEXT DEFAULT 'new', createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, articleId INTEGER, step TEXT NOT NULL, status TEXT NOT NULL, log TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS social_posts(id INTEGER PRIMARY KEY AUTOINCREMENT, articleId INTEGER, channel TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, response TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS editorial_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT 'redaktion', assignee TEXT NOT NULL DEFAULT 'Newsdesk', status TEXT NOT NULL DEFAULT 'backlog', priority TEXT NOT NULL DEFAULT 'normal', articleId INTEGER, dueAt TEXT, createdBy TEXT NOT NULL DEFAULT 'CEO', createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS editorial_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0, costUsd REAL DEFAULT 0, createdAt TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS editorial_calendar(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, channel TEXT NOT NULL, contentType TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', scheduledAt TEXT, articleId INTEGER, notes TEXT NOT NULL DEFAULT '', createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS brand_posts(id INTEGER PRIMARY KEY AUTOINCREMENT, articleId INTEGER, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, excerpt TEXT NOT NULL, body TEXT NOT NULL, sourceUrl TEXT, heroImage TEXT, status TEXT NOT NULL DEFAULT 'draft', publishedAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_usage(id INTEGER PRIMARY KEY AUTOINCREMENT, scenario TEXT NOT NULL, model TEXT NOT NULL, promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0, costUsd REAL DEFAULT 0, createdAt TEXT DEFAULT CURRENT_TIMESTAMP);`);
const sourceColumns = new Set((db.prepare('pragma table_info(sources)').all() as { name: string }[]).map((column) => column.name));
if (!sourceColumns.has('lastCrawlError')) db.exec('ALTER TABLE sources ADD COLUMN lastCrawlError TEXT');
if (!sourceColumns.has('lastCrawlStatus')) db.exec('ALTER TABLE sources ADD COLUMN lastCrawlStatus TEXT');
const articleColumns = new Set((db.prepare('pragma table_info(articles)').all() as { name: string }[]).map((column) => column.name));
if (!articleColumns.has('videoDescription')) db.exec('ALTER TABLE articles ADD COLUMN videoDescription TEXT');
export type Source = { id:number; name:string; url:string; intervalMinutes:number; active:number; lastCrawledAt:string|null; lastCrawlError:string|null; lastCrawlStatus:string|null };
export type Article = { id:number; sourceId:number|null; url:string; title:string; rawText:string; rewrittenText:string|null; videoDescription:string|null; imagePrompt:string|null; audioPath:string|null; imagePath:string|null; videoPath:string|null; youtubeUrl:string|null; status:string; createdAt:string; updatedAt:string };
export const sql = db;
export function getSettings(){ return Object.fromEntries(db.prepare('select key,value from settings').all().map((r:any)=>[r.key, JSON.parse(r.value)])); }
export function setSettings(input: Record<string, unknown>){ const stmt=db.prepare('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value'); const tx=db.transaction((entries:[string,unknown][])=>entries.forEach(([k,v])=>stmt.run(k,JSON.stringify(v)))); tx(Object.entries(input)); }
