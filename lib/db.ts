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
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, articleId INTEGER, step TEXT NOT NULL, status TEXT NOT NULL, log TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP);`);
export type Source = { id:number; name:string; url:string; intervalMinutes:number; active:number; lastCrawledAt:string|null };
export type Article = { id:number; sourceId:number|null; url:string; title:string; rawText:string; rewrittenText:string|null; imagePrompt:string|null; audioPath:string|null; imagePath:string|null; videoPath:string|null; youtubeUrl:string|null; status:string; createdAt:string; updatedAt:string };
export const sql = db;
export function getSettings(){ return Object.fromEntries(db.prepare('select key,value from settings').all().map((r:any)=>[r.key, JSON.parse(r.value)])); }
export function setSettings(input: Record<string, unknown>){ const stmt=db.prepare('insert into settings(key,value) values(?,?) on conflict(key) do update set value=excluded.value'); const tx=db.transaction((entries:[string,unknown][])=>entries.forEach(([k,v])=>stmt.run(k,JSON.stringify(v)))); tx(Object.entries(input)); }
