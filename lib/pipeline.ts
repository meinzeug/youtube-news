import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as cheerio from 'cheerio';
import { sql, getSettings, type Article } from './db';
import { getVideoDimensions, normalizeVideoSettings, type VideoSettings } from './video-settings';
import { ensureSourceAttribution, sourceLabel as sourceLabelFromUrl } from './source-attribution';

const outDir = path.join(process.cwd(), 'public', 'generated');
const userAgent = 'Mozilla/5.0 (compatible; YouTubeNewsStudio/1.0; +https://localhost)';
const text2wavCli = createRequire(import.meta.url).resolve('text2wav');

type VideoPlan = {
  script: string;
  imagePrompt: string;
  title: string;
  description: string;
  chapters: string[];
  lowerThird: string;
  safetyNotes: string[];
};

type VisualSet = {
  poster: string;
  scenes: string[];
};

type SourceImage = {
  dataUri: string;
  localPath: string;
};

async function ensure() {
  await fs.mkdir(outDir, { recursive: true });
}

export async function runPipeline(articleId: number) {
  await ensure();
  const article = sql.prepare('select * from articles where id=?').get(articleId) as Article;
  if (!article) throw new Error('Artikel wurde nicht gefunden.');

  const settings = getSettings() as Record<string, unknown>;
  const videoSettings = normalizeVideoSettings(settings);
  const plan = await planVideo(article, settings, videoSettings);
  const renderSettings = { ...videoSettings, lowerThirdText: plan.lowerThird || videoSettings.lowerThirdText };

  await writeProductionBrief(articleId, plan, renderSettings);
  sql.prepare('update articles set rewrittenText=?, videoDescription=?, imagePrompt=?, status=?, updatedAt=CURRENT_TIMESTAMP where id=?')
    .run(plan.script, plan.description, plan.imagePrompt, 'scripted', articleId);

  const audio = await synthesize(articleId, plan.script, settings);
  const visuals = await createVisuals(articleId, article, plan, renderSettings);
  const video = await createVideo(articleId, audio, visuals.scenes, renderSettings);

  sql.prepare('update articles set audioPath=?, imagePath=?, videoPath=?, status=?, updatedAt=CURRENT_TIMESTAMP where id=?')
    .run(audio, visuals.poster, video, 'video_ready', articleId);
  return video;
}

async function planVideo(article: Article, settings: Record<string, unknown>, videoSettings: VideoSettings): Promise<VideoPlan> {
  const sourceName = articleSourceName(article);
  const fallback = buildFallbackPlan(article, videoSettings, sourceName);
  if (!settings.openRouterKey || !videoSettings.aiEnhancementEnabled) return fallback;

  const schema = {
    type: 'object',
    properties: {
      script: { type: 'string' },
      imagePrompt: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      chapters: { type: 'array', items: { type: 'string' } },
      lowerThird: { type: 'string' },
      safetyNotes: { type: 'array', items: { type: 'string' } },
    },
    required: ['script', 'imagePrompt', 'title', 'description', 'chapters', 'lowerThird', 'safetyNotes'],
    additionalProperties: false,
  };
  const modeHints: Record<string, string> = {
    balanced: 'kompakt, verständlich, mit Einordnung',
    shorts: 'sehr schnell, hookstark, vertikal geeignet',
    deepDive: 'ausführlicher Hintergrund mit klaren Abschnitten',
    breaking: 'dringend, aber ohne Spekulation',
  };

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${settings.openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'YouTube News Automation',
      },
      body: JSON.stringify({
        model: settings.openRouterTextModel || 'openai/gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `Du bist ein deutschsprachiger YouTube-News-Produzent. Erstelle ein sendefertiges Videokonzept als JSON. Wir greifen Meldungen unabhängiger, alternativer und etablierter Medien auf, erstellen daraus aber eine eigenständige redaktionelle Fassung. Schreibe deshalb einen neuen Sprechertext mit eigener Struktur und Formulierung; kopiere weder Aufbau noch längere Passagen des Quelltexts und betreibe keine bloße Synonym-Ersetzung. Übernimm nur die belegten Sachinformationen. Ordne Behauptungen der Quelle transparent mit Formulierungen wie „laut ${sourceName}“ oder „wie ${sourceName} berichtet“ zu und erwecke nicht den Eindruck eigener Vor-Ort-Recherche. Kurze Zitate nur wenn unverzichtbar und klar als Zitat markiert. Die description muss eine eigenständige Zusammenfassung, eine faire Nennung von ${sourceName}, den vollständigen Originallink ${article.url} und einen freundlichen Hinweis enthalten, den Originalbeitrag für weitere Hintergründe zu besuchen. Behaupte keine Partnerschaft oder Zustimmung der Quelle. Nutze keine erfundenen Fakten. Stil: ${modeHints[videoSettings.aiScriptMode]}. Ton: ${videoSettings.aiTone}. Zielgruppe: ${videoSettings.aiAudience}. Zieldauer: ${videoSettings.aiTargetDuration} Sekunden. Hook gewünscht: ${videoSettings.aiIncludeHook ? 'ja' : 'nein'}. Kapitel gewünscht: ${videoSettings.aiIncludeChapters ? 'ja' : 'nein'}. Faktenregel: ${videoSettings.aiFactCheckPrompt}. CTA: ${videoSettings.callToAction}`,
          },
          { role: 'user', content: `Titel: ${article.title}\nQuelle-URL: ${article.url}\nRohtext: ${article.rawText}` },
        ],
        temperature: 0.55,
        response_format: { type: 'json_schema', json_schema: { name: 'youtube_news_video_plan', strict: true, schema } },
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    const json = await response.json() as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content || '{}');
    return {
      script: String(parsed.script || fallback.script),
      imagePrompt: `${videoSettings.thumbnailStyle} ${videoSettings.aiImagePromptStyle}: ${parsed.imagePrompt || article.title}`,
      title: String(parsed.title || fallback.title),
      description: ensureSourceAttribution(String(parsed.description || fallback.description), sourceName, article.url),
      chapters: Array.isArray(parsed.chapters) ? parsed.chapters.map(String) : fallback.chapters,
      lowerThird: String(parsed.lowerThird || fallback.lowerThird),
      safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes.map(String) : [],
    };
  } catch (error) {
    return {
      ...fallback,
      safetyNotes: [`OpenRouter nicht verfügbar, lokale Planung genutzt: ${error instanceof Error ? error.message.slice(0, 180) : 'unbekannter Fehler'}`],
    };
  }
}

function buildFallbackPlan(article: Article, videoSettings: VideoSettings, sourceName: string): VideoPlan {
  const script = [
    'Hier ist das aktuelle Nachrichten-Update.',
    article.title,
    `Nach Angaben von ${sourceName} geht es dabei um Folgendes: ${article.rawText}`,
    'Das sind die derzeit vorliegenden Informationen.',
    videoSettings.callToAction,
  ].filter(Boolean).join(' ');
  return {
    script,
    imagePrompt: `${videoSettings.thumbnailStyle}: ${article.title}`,
    title: article.title,
    description: ensureSourceAttribution(article.rawText.slice(0, 700), sourceName, article.url),
    chapters: videoSettings.aiIncludeChapters ? ['00:00 Überblick', '00:10 Meldung', '00:25 Zusammenfassung'] : [],
    lowerThird: videoSettings.lowerThirdText || 'Aktuelle Nachrichten',
    safetyNotes: ['Skript lokal aus Titel und Quelltext erstellt, Quelle transparent genannt und Originalbeitrag verlinkt.'],
  };
}

async function writeProductionBrief(id: number, plan: VideoPlan, videoSettings: VideoSettings) {
  const brief = [
    `# Produktionsbrief Artikel ${id}`,
    `Titel: ${plan.title}`,
    `Bauchbinde: ${plan.lowerThird}`,
    `Format: ${videoSettings.aspectRatio} ${videoSettings.resolution}`,
    '',
    'Beschreibung:',
    plan.description,
    '',
    'Kapitel:',
    ...plan.chapters.map((chapter) => `- ${chapter}`),
    '',
    'Sicherheitsnotizen:',
    ...(plan.safetyNotes.length ? plan.safetyNotes.map((note) => `- ${note}`) : ['- Keine']),
  ].join('\n');
  await fs.writeFile(path.join(outDir, `article-${id}-brief.md`), brief);
}

async function synthesize(id: number, text: string, settings: Record<string, unknown>) {
  await fs.writeFile(path.join(outDir, `article-${id}.txt`), text);

  if (settings.elevenLabsKey) {
    try {
      const voice = String(settings.elevenLabsVoiceId || '21m00Tcm4TlvDq8ikWAM');
      const model = String(settings.elevenLabsModelId || 'eleven_multilingual_v2');
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
        headers: { 'xi-api-key': String(settings.elevenLabsKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: model }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
      const file = `/generated/article-${id}.mp3`;
      await fs.writeFile(path.join(process.cwd(), 'public', file), Buffer.from(await response.arrayBuffer()));
      return file;
    } catch {
      // A broken or temporarily unavailable cloud connection must not stop local production.
    }
  }

  const file = `/generated/article-${id}.wav`;
  const voiceSetting = String(settings.localTtsVoice || 'de');
  const voice = /^[a-z0-9+_-]+$/i.test(voiceSetting) ? voiceSetting : 'de';
  const speed = Math.max(80, Math.min(300, Number(settings.localTtsSpeed || 155)));
  let wav: Buffer;
  try {
    wav = await synthesizeLocalSpeech(text, voice, speed);
  } catch {
    wav = await synthesizeLocalSpeech(text, 'de', 155);
  }
  if (wav.length < 44 || wav.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Die lokale Sprachausgabe hat keine gültige WAV-Datei erzeugt.');
  }
  await fs.writeFile(path.join(process.cwd(), 'public', file), wav);
  return file;
}

async function synthesizeLocalSpeech(text: string, voice: string, speed: number) {
  const nodeOptions = [process.env.NODE_OPTIONS, '--no-experimental-fetch'].filter(Boolean).join(' ');
  return runCaptureBuffer(
    process.execPath,
    [text2wavCli, text, '-v', voice, '-s', String(speed), '-p', '46', '-g', '2'],
    { ...process.env, NODE_OPTIONS: nodeOptions },
  );
}

async function createVisuals(id: number, article: Article, plan: VideoPlan, videoSettings: VideoSettings): Promise<VisualSet> {
  const { width, height } = getVideoDimensions(videoSettings);
  const sourceImage = videoSettings.useSourceImages ? await fetchSourceImage(id, article.url) : null;
  const sourceName = sourceLabel(article.url);
  const specs = [
    { kicker: 'AKTUELLES UPDATE', title: plan.title, body: sourceName, image: sourceImage?.dataUri },
    { kicker: 'WORUM ES GEHT', title: 'Die Meldung', body: article.rawText, image: sourceImage?.dataUri },
    { kicker: 'KURZ ZUSAMMENGEFASST', title: 'Das Wichtigste', body: plan.description || article.rawText, image: undefined },
  ];
  const scenes: string[] = [];

  for (let index = 0; index < specs.length; index += 1) {
    const file = `/generated/article-${id}-scene-${index + 1}.svg`;
    const svg = renderSceneSvg({
      ...specs[index],
      width,
      height,
      index,
      count: specs.length,
      sourceName,
      settings: videoSettings,
    });
    await fs.writeFile(path.join(process.cwd(), 'public', file), svg);
    scenes.push(file);
  }

  const poster = `/generated/article-${id}.svg`;
  await fs.copyFile(path.join(process.cwd(), 'public', scenes[0]), path.join(process.cwd(), 'public', poster));
  if (sourceImage) {
    await fs.writeFile(path.join(outDir, `article-${id}-image-source.txt`), `${article.url}\n${sourceImage.localPath}\n`);
  }
  return { poster, scenes };
}

async function fetchSourceImage(id: number, articleUrl: string): Promise<SourceImage | null> {
  try {
    const pageUrl = new URL(articleUrl);
    if (!['http:', 'https:'].includes(pageUrl.protocol)) return null;
    const page = await fetch(pageUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
    });
    if (!page.ok) return null;
    const html = await page.text();
    const $ = cheerio.load(html);
    const candidate =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('article img[src]').first().attr('src');
    if (!candidate) return null;

    const imageUrl = new URL(candidate, page.url).toString();
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': userAgent, accept: 'image/avif,image/webp,image/png,image/jpeg' },
    });
    if (!response.ok) return null;
    const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    const extension = extensions[mime];
    if (!extension) return null;
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > 12 * 1024 * 1024) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) return null;

    const localPath = `/generated/article-${id}-source.${extension}`;
    await fs.writeFile(path.join(process.cwd(), 'public', localPath), bytes);
    return { dataUri: `data:${mime};base64,${bytes.toString('base64')}`, localPath };
  } catch {
    return null;
  }
}

function renderSceneSvg(input: {
  width: number;
  height: number;
  index: number;
  count: number;
  kicker: string;
  title: string;
  body: string;
  image?: string;
  sourceName: string;
  settings: VideoSettings;
}) {
  const { width, height, index, count, settings } = input;
  const portrait = width < height;
  const margin = Math.round(width * (portrait ? 0.07 : 0.065));
  const titleSize = Math.round(Math.min(width * (portrait ? 0.078 : 0.044), height * 0.088));
  const bodySize = Math.round(Math.min(width * (portrait ? 0.047 : 0.026), height * 0.05));
  const titleWidth = Math.max(12, Math.floor((width - margin * 2) / (titleSize * 0.56)));
  const bodyWidth = Math.max(16, Math.floor((width - margin * 2) / (bodySize * 0.53)));
  const titleLines = wrapText(input.title, titleWidth, portrait ? 5 : 4);
  const bodyLines = wrapText(input.body, bodyWidth, portrait ? 7 : 5);
  const titleY = Math.round(height * 0.28);
  const titleHeight = titleSize * 1.15;
  const bodyY = titleY + titleLines.length * titleHeight + bodySize * 1.25;
  const bodyHeight = bodySize * 1.38;
  const background = input.image
    ? `<image href="${input.image}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/><rect width="100%" height="100%" fill="#020617" opacity="${index === 0 ? '0.58' : '0.72'}"/>`
    : `<rect width="100%" height="100%" fill="url(#background)"/><circle cx="${Math.round(width * 0.86)}" cy="${Math.round(height * 0.18)}" r="${Math.round(Math.min(width, height) * 0.22)}" fill="${xml(settings.accentColor)}" opacity="0.2"/><path d="M0 ${Math.round(height * 0.78)} L${width} ${Math.round(height * 0.48)} L${width} ${height} L0 ${height} Z" fill="${xml(settings.accentColor)}" opacity="0.12"/>`;
  const lowerThird = settings.lowerThirdEnabled
    ? `<rect x="0" y="${height - Math.round(height * 0.1)}" width="${width}" height="${Math.round(height * 0.1)}" fill="#020617" opacity="0.92"/><rect x="0" y="${height - Math.round(height * 0.1)}" width="${Math.max(8, Math.round(width * 0.008))}" height="${Math.round(height * 0.1)}" fill="${xml(settings.accentColor)}"/><text x="${margin}" y="${height - Math.round(height * 0.038)}" fill="#e5e7eb" font-size="${Math.round(bodySize * 0.72)}" font-family="Arial, sans-serif" font-weight="700">${xml(settings.lowerThirdText)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${xml(settings.backgroundColor)}"/><stop offset="1" stop-color="#020617"/></linearGradient></defs>
  ${background}
  <rect x="${margin}" y="${Math.round(height * 0.105)}" rx="${Math.round(bodySize * 0.42)}" width="${Math.round(input.kicker.length * bodySize * 0.55 + bodySize * 1.4)}" height="${Math.round(bodySize * 1.55)}" fill="${xml(settings.accentColor)}"/>
  <text x="${margin + Math.round(bodySize * 0.68)}" y="${Math.round(height * 0.105) + Math.round(bodySize * 1.05)}" fill="white" font-size="${Math.round(bodySize * 0.68)}" font-family="Arial, sans-serif" font-weight="700" letter-spacing="2">${xml(input.kicker)}</text>
  <text x="${margin}" y="${titleY}" fill="white" font-size="${titleSize}" font-family="Arial, sans-serif" font-weight="800">${svgLines(titleLines, margin, titleY, titleHeight)}</text>
  <text x="${margin}" y="${bodyY}" fill="#e2e8f0" font-size="${bodySize}" font-family="Arial, sans-serif" font-weight="400">${svgLines(bodyLines, margin, bodyY, bodyHeight)}</text>
  <text x="${width - margin}" y="${Math.round(height * 0.08)}" fill="#cbd5e1" text-anchor="end" font-size="${Math.round(bodySize * 0.65)}" font-family="Arial, sans-serif">${xml(input.sourceName)} · ${index + 1}/${count}</text>
  ${lowerThird}
</svg>`;
}

function svgLines(lines: string[], x: number, y: number, lineHeight: number) {
  return lines.map((line, index) => `<tspan x="${x}" y="${Math.round(y + index * lineHeight)}">${xml(line)}</tspan>`).join('');
}

function wrapText(value: string, maxChars: number, maxLines: number) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) return [''];
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:!?]?$/, '')}…`;
  }
  return lines;
}

function sourceLabel(url: string) {
  return sourceLabelFromUrl(url);
}

function articleSourceName(article: Article) {
  if (article.sourceId) {
    const source = sql.prepare('select name from sources where id=?').get(article.sourceId) as { name?: string } | undefined;
    if (source?.name) return source.name.trim();
  }
  return sourceLabelFromUrl(article.url);
}

async function createVideo(id: number, audio: string, scenes: string[], videoSettings: VideoSettings) {
  const file = `/generated/article-${id}.mp4`;
  const full = path.join(process.cwd(), 'public', file);
  const { width, height } = getVideoDimensions(videoSettings);
  const main = path.join(outDir, `article-${id}-main.mp4`);
  await renderSlideshowVideo(scenes.map(publicPath), publicPath(audio), main, width, height);

  const segments: string[] = [];
  const intro = await createBumper(id, 'intro', videoSettings.introMode, videoSettings.introText, videoSettings.introDuration, videoSettings.introAssetPath, videoSettings, width, height);
  if (intro) segments.push(intro);
  segments.push(main);
  const outro = await createBumper(id, 'outro', videoSettings.outroMode, videoSettings.outroText, videoSettings.outroDuration, videoSettings.outroAssetPath, videoSettings, width, height);
  if (outro) segments.push(outro);

  if (segments.length === 1) {
    await fs.rename(main, full);
    return file;
  }
  const list = path.join(outDir, `article-${id}-concat.txt`);
  await fs.writeFile(list, segments.map((segment) => `file '${segment.replace(/'/g, "'\\''")}'`).join('\n'));
  await run('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-movflags', '+faststart', full,
  ]);
  return file;
}

async function renderSlideshowVideo(scenePaths: string[], audioPath: string, outputPath: string, width: number, height: number) {
  const audioDuration = await mediaDuration(audioPath);
  const sceneDuration = audioDuration / scenePaths.length;
  const inputArgs = scenePaths.flatMap((scene) => ['-loop', '1', '-framerate', '30', '-t', sceneDuration.toFixed(3), '-i', scene]);
  const filters = scenePaths.map((_, index) => `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30,format=yuv420p[v${index}]`);
  const concatInputs = scenePaths.map((_, index) => `[v${index}]`).join('');
  filters.push(`${concatInputs}concat=n=${scenePaths.length}:v=1:a=0[vout]`);
  await run('ffmpeg', [
    '-y', ...inputArgs, '-i', audioPath,
    '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', `${scenePaths.length}:a:0`,
    '-t', audioDuration.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath,
  ]);
}

async function createBumper(
  id: number,
  slot: 'intro' | 'outro',
  mode: string,
  text: string,
  duration: number,
  assetPath: string,
  videoSettings: VideoSettings,
  width: number,
  height: number,
) {
  if (mode === 'none') return null;
  const output = path.join(outDir, `article-${id}-${slot}.mp4`);
  let input = assetPath ? publicPath(assetPath) : '';
  if (input && !await fileExists(input)) input = '';

  if (mode === 'generated' || !input) {
    const svgPath = path.join(outDir, `article-${id}-${slot}.svg`);
    const fontSize = Math.round(Math.min(width * 0.06, height * 0.09));
    const margin = Math.round(width * 0.08);
    const lines = wrapText(text, Math.max(12, Math.floor((width - margin * 2) / (fontSize * 0.56))), 4);
    const startY = Math.round(height / 2 - ((lines.length - 1) * fontSize * 0.62));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="${xml(videoSettings.backgroundColor)}"/><stop offset="1" stop-color="#020617"/></linearGradient></defs><rect fill="url(#g)" width="100%" height="100%"/><circle cx="${Math.round(width * 0.86)}" cy="${Math.round(height * 0.2)}" r="${Math.round(Math.min(width, height) * 0.13)}" fill="${xml(videoSettings.accentColor)}" opacity="0.85"/><text x="${margin}" y="${startY}" fill="white" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="700">${svgLines(lines, margin, startY, fontSize * 1.2)}</text></svg>`;
    await fs.writeFile(svgPath, svg);
    input = svgPath;
  }

  const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(input);
  const inputArgs = isVideo ? ['-stream_loop', '-1', '-i', input] : ['-loop', '1', '-framerate', '30', '-i', input];
  await run('ffmpeg', [
    '-y', ...inputArgs, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-map', '0:v:0', '-map', '1:a:0', '-t', String(duration),
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ]);
  return output;
}

async function mediaDuration(file: string) {
  const output = await runCapture('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const duration = Number(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Ungültige Audiodauer für ${file}`);
  return duration;
}

function publicPath(value: string) {
  return path.join(process.cwd(), 'public', value.startsWith('/') ? value.slice(1) : value);
}

async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] || character);
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const process = spawn(command, args);
    let stderr = '';
    process.stderr.on('data', (data) => { stderr += data; });
    process.on('error', reject);
    process.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-4000))));
  });
}

function runCapture(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const process = spawn(command, args);
    let stdout = '';
    let stderr = '';
    process.stdout.on('data', (data) => { stdout += data; });
    process.stderr.on('data', (data) => { stderr += data; });
    process.on('error', reject);
    process.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
}

function runCaptureBuffer(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<Buffer>((resolve, reject) => {
    const process = spawn(command, args, { env });
    const stdout: Buffer[] = [];
    let stderr = '';
    process.stdout.on('data', (data: Buffer) => { stdout.push(data); });
    process.stderr.on('data', (data) => { stderr += data; });
    process.on('error', reject);
    process.on('close', (code) => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new Error(stderr)));
  });
}
