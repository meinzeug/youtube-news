import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const homeUrl = 'https://nuoflix.de/';
const userAgent = 'Mozilla/5.0 (compatible; YouTubeNewsStudio-Research/1.0)';
const requestedLimit = Math.max(300, Math.min(1000, Number(process.argv[2] || 350)));
const concurrency = Math.max(1, Math.min(8, Number(process.argv[3] || 5)));
const outputDir = path.join(process.cwd(), 'data', 'research');

const reviewedPeople = [
  'Achim Winter', 'Aloys Eiling', 'Andreas Beutel', 'Andreas Hoppe', 'Andreas Winter', 'Armin Risi',
  'Axel Breitung', 'Axel Fischer', 'Beate Bahner', 'Caroline Raasch', 'Christoph Hörstel', 'Collin McMahon',
  'Dietmar Czycholl', 'DJ Bobo', 'Dominique Görlitz', 'Donald Trump', 'Eckart Ruschmann', 'Eike Hamer',
  'Elistan Snowley', 'Engelbert Winkler', 'Erich von Däniken', 'Frank Höfer', 'Frank Köstler', 'Frank Stoner',
  'Franz Esser', 'Georg Bremges', 'Gerhard Wisnewski', 'Gerold Keefer', 'Gunter Frank', 'Hans Jelitto',
  'Harald Havas', 'Helmut Sterz', 'Herwig Ronacher', 'Jeffrey Epstein', 'Jeffrey Sachs', 'Julia Neigel',
  'Julia Szarvasy', 'Jürgen Habermas', 'Katrin Huß', 'Kay Ray', 'Klaus Hartmann', 'Lars Hünich',
  'Markus Fiedler', 'Max Otte', 'Michael Sailer', 'Michael Wolski', 'Nikolai Binner', 'Oliver Janich',
  'Patrik Baab', 'Ralph Boes', 'Robert Fleischer', 'Robert Stein', 'Roland Wiesendanger', 'Sabine Stebel',
  'Serge Menga', 'Snicklink', 'Stefan Spiegelsperger', 'Thomas Röper', 'Tilman Knechtel', 'Tom Lausen',
  'Ulrich Mies', 'Uwe Boll', 'Uwe Steimle', 'Walter von Laack', 'Wilhelm Domke-Schulz', 'Wolfgang Effenberger',
  'Yann Song King', 'Zahi Hawass',
] as const;
const reviewedPeopleLookup = new Map(reviewedPeople.map((name) => [fold(name), name]));

type ArticleSeed = { title: string; url: string };
type ArticleResearch = ArticleSeed & { description: string; names: string[]; status: number | null };

const leadingPatterns = [
  /(?:im gespräch mit|interview mit|zu gast(?: bei)?|mit|von|bei|präsentiert|berichtet(?: aus)?|nachruf (?:auf|von))\s+((?:Dr\.?\s+|Prof\.?\s+)?[A-ZÄÖÜ][\p{L}'’-]+(?:\s+(?:von|van|de|der|zu|zur))?\s+[A-ZÄÖÜ][\p{L}'’-]+(?:\s+[A-ZÄÖÜ][\p{L}'’-]+)?)/giu,
  /[-–—|:]\s*((?:Dr\.?\s+|Prof\.?\s+)?[A-ZÄÖÜ][\p{L}'’-]+\s+[A-ZÄÖÜ][\p{L}'’-]+(?:\s+[A-ZÄÖÜ][\p{L}'’-]+)?)\s*(?:\([^)]*\))?$/gu,
  /\(((?:Dr\.?\s+|Prof\.?\s+)?[A-ZÄÖÜ][\p{L}'’-]+\s+[A-ZÄÖÜ][\p{L}'’-]+(?:\s+[A-ZÄÖÜ][\p{L}'’-]+)?)\)/gu,
];

const rejectedWords = new Set([
  'Home Office', 'Frank und', 'Aktuelle Lage', 'Ersten Weltkrieg', 'Zweiten Weltkrieg', 'Neue Weltordnung',
  'Europäische Union', 'Vereinigten Staaten', 'Deutschen Bundestag', 'Künstliche Intelligenz', 'Rote Pille',
  'Nuo Flix', 'Nuo Vision', 'Abora Tv', 'Regentreff Jetzt', 'Tacheles Heute', 'Live Kommentiert',
]);

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const allSeeds = await discoverSeeds();
  const seeds = allSeeds.slice(0, requestedLimit);
  const articles = await mapLimit(seeds, concurrency, inspectArticle);
  const nameMap = new Map<string, { count: number; articles: { title: string; url: string }[] }>();

  for (const article of articles) {
    for (const name of article.names) {
      const current = nameMap.get(name) || { count: 0, articles: [] };
      current.count += 1;
      current.articles.push({ title: article.title, url: article.url });
      nameMap.set(name, current);
    }
  }

  const names = Array.from(nameMap, ([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
  const generatedAt = new Date().toISOString();
  const successful = articles.filter((article) => article.status === 200).length;
  const report = {
    generatedAt,
    source: homeUrl,
    availableUniqueArticles: allSeeds.length,
    requested: requestedLimit,
    analyzed: articles.length,
    successfulPageFetches: successful,
    uniqueNameCandidates: names.length,
    methodology: 'NuoFlix-Karten der Startseite, Detailseiten-Metadaten und konservative Namensmuster in Titeln/Beschreibungen. Kandidaten sind redaktionell zu prüfen.',
    articles,
  };

  await fs.writeFile(path.join(outputDir, 'nuoflix-articles.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, 'nuoflix-names.json'), `${JSON.stringify({ generatedAt, analyzedArticles: articles.length, names }, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, 'nuoflix-report.md'), renderMarkdown(report, names));
  console.log(JSON.stringify({ generatedAt, available: report.availableUniqueArticles, analyzed: articles.length, successful, names: names.length, topNames: names.slice(0, 20).map((item) => `${item.name} (${item.count})`) }, null, 2));
}

async function discoverSeeds(): Promise<ArticleSeed[]> {
  const response = await fetch(homeUrl, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': userAgent } });
  if (!response.ok) throw new Error(`NuoFlix-Startseite antwortet mit HTTP ${response.status}`);
  const $ = cheerio.load(await response.text());
  const seeds: ArticleSeed[] = [];
  const seen = new Set<string>();
  $('.movieItem a[href][title]').each((_, element) => {
    const anchor = $(element);
    const title = clean(anchor.attr('title') || '');
    const href = anchor.attr('href');
    if (!title || !href) return;
    const url = new URL(href, homeUrl).toString();
    if (seen.has(url)) return;
    seen.add(url);
    seeds.push({ title, url });
  });
  return seeds;
}

async function inspectArticle(seed: ArticleSeed): Promise<ArticleResearch> {
  try {
    const response = await fetch(seed.url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': userAgent } });
    const $ = cheerio.load(await response.text());
    const title = clean($('meta[property="og:title"]').attr('content') || seed.title).replace(/ jetzt im Stream bei NuoFlix ansehen.*$/i, '');
    const description = clean($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '');
    return { title, url: seed.url, description, names: extractNames(`${title}. ${description}`), status: response.status };
  } catch {
    return { ...seed, description: '', names: extractNames(seed.title), status: null };
  }
}

function extractNames(text: string) {
  const names = new Set<string>();
  const foldedText = ` ${fold(text)} `;
  for (const [foldedName, displayName] of reviewedPeopleLookup) {
    if (foldedText.includes(` ${foldedName} `)) names.add(displayName);
  }
  for (const pattern of leadingPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const name = normalizeName(match[1]);
      const canonicalName = canonicalReviewedPerson(name);
      if (isPlausibleName(name) && canonicalName) names.add(canonicalName);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'de'));
}

function normalizeName(value: string) {
  return clean(value)
    .replace(/^(?:Dr|Prof)\.?\s+/i, '')
    .replace(/\s+(?:jetzt|heute|live|berichtet|spricht|erklärt)$/i, '')
    .replace(/[,:;.!?]+$/, '');
}

function isPlausibleName(value: string) {
  const words = value.split(/\s+/);
  if (words.length < 2 || words.length > 4 || value.length > 70) return false;
  if (rejectedWords.has(value)) return false;
  const structurallyValid = words.filter((word) => !/^(?:von|van|de|der|zu|zur)$/i.test(word)).every((word) => /^[A-ZÄÖÜ][\p{L}'’-]+$/u.test(word));
  return structurallyValid && Boolean(canonicalReviewedPerson(value));
}

function canonicalReviewedPerson(value: string) {
  const candidate = fold(value);
  const exact = reviewedPeopleLookup.get(candidate);
  if (exact) return exact;
  const matches = Array.from(reviewedPeopleLookup).filter(([foldedName]) => foldedName.startsWith(candidate) || candidate.startsWith(foldedName));
  return matches.length === 1 ? matches[0][1] : null;
}

function clean(value: string) {
  return value.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function fold(value: string) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

function renderMarkdown(report: { generatedAt: string; source: string; availableUniqueArticles: number; analyzed: number; successfulPageFetches: number; uniqueNameCandidates: number; methodology: string }, names: { name: string; count: number; articles: { title: string; url: string }[] }[]) {
  const rows = names.map((item) => `| ${item.name.replace(/\|/g, '\\|')} | ${item.count} | [Beispiel](${item.articles[0].url}) |`).join('\n');
  return `# NuoFlix-Beitrags- und Namensrecherche\n\n- Erstellt: ${report.generatedAt}\n- Quelle: ${report.source}\n- Eindeutige Beiträge auf der Startseite: ${report.availableUniqueArticles}\n- Analysierte Beiträge: ${report.analyzed}\n- Erfolgreich geladene Detailseiten: ${report.successfulPageFetches}\n- Extrahierte Namenskandidaten: ${report.uniqueNameCandidates}\n- Methode: ${report.methodology}\n\n## Namenskandidaten\n\n| Name | Nennungen | Beispiel |\n|---|---:|---|\n${rows}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
