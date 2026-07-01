export type VideoSettings = {
  youtubeTitleTemplate: string;
  youtubeDescriptionTemplate: string;
  youtubeTags: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  language: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  resolution: '720p' | '1080p';
  backgroundColor: string;
  accentColor: string;
  introMode: 'none' | 'generated' | 'asset';
  introText: string;
  introDuration: number;
  introAssetPath: string;
  outroMode: 'none' | 'generated' | 'asset';
  outroText: string;
  outroDuration: number;
  outroAssetPath: string;
  lowerThirdEnabled: boolean;
  lowerThirdText: string;
  useSourceImages: boolean;
  thumbnailStyle: 'editorial' | 'breaking' | 'minimal' | 'documentary' | 'shorts';
  callToAction: string;
  aiEnhancementEnabled: boolean;
  aiScriptMode: 'balanced' | 'shorts' | 'deepDive' | 'breaking';
  aiTone: 'neutral' | 'urgent' | 'explainer' | 'optimistic';
  aiAudience: string;
  aiTargetDuration: number;
  aiIncludeChapters: boolean;
  aiIncludeHook: boolean;
  aiFactCheckPrompt: string;
  aiImagePromptStyle: string;
  aiSuggestedModels: string;
};

export const latestOpenRouterModelSuggestions = [
  'openai/gpt-4.1-mini',
  'anthropic/claude-sonnet-4',
  'google/gemini-2.5-pro',
  'meta-llama/llama-4-maverick',
  'openrouter/auto',
];

export const defaultVideoSettings: VideoSettings = {
  youtubeTitleTemplate: '{{title}}',
  youtubeDescriptionTemplate: '{{summary}}\n\nKapitel:\n{{chapters}}',
  youtubeTags: 'news, nachrichten, politik, wirtschaft, aktuell',
  privacyStatus: 'private',
  language: 'de',
  aspectRatio: '16:9',
  resolution: '1080p',
  backgroundColor: '#111827',
  accentColor: '#dc2626',
  introMode: 'generated',
  introText: 'YouTube News Update',
  introDuration: 3,
  introAssetPath: '',
  outroMode: 'generated',
  outroText: 'Abonnieren für weitere News',
  outroDuration: 4,
  outroAssetPath: '',
  lowerThirdEnabled: true,
  lowerThirdText: 'Aktuelle Nachrichten',
  useSourceImages: true,
  thumbnailStyle: 'editorial',
  callToAction: 'Wenn dir dieses Update geholfen hat, abonniere den Kanal.',
  aiEnhancementEnabled: true,
  aiScriptMode: 'balanced',
  aiTone: 'neutral',
  aiAudience: 'deutschsprachige YouTube-Zuschauer, die schnelle und verlässliche Einordnung erwarten',
  aiTargetDuration: 60,
  aiIncludeChapters: true,
  aiIncludeHook: true,
  aiFactCheckPrompt: 'Markiere unsichere Angaben als laut Quelle/berichtete Angaben und erfinde keine Zahlen, Namen oder Zitate. Formuliere eigenständig, nenne das Ursprungsmedium fair und verweise für Details auf den verlinkten Originalbeitrag.',
  aiImagePromptStyle: 'realistische Editorial-Illustration, starke Headline-Fläche, keine Logos, keine Gesichter realer Personen ohne sichere Quelle',
  aiSuggestedModels: latestOpenRouterModelSuggestions.join(', '),
};

const bool = (value: unknown, fallback = false) => value === undefined ? fallback : value === true || value === 'true' || value === 'on' || value === '1';
const num = (value: unknown, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Number(value || fallback)));
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;

export function normalizeVideoSettings(input: Record<string, unknown> = {}): VideoSettings {
  const d = defaultVideoSettings;
  return {
    youtubeTitleTemplate: String(input.youtubeTitleTemplate || d.youtubeTitleTemplate),
    youtubeDescriptionTemplate: String(input.youtubeDescriptionTemplate || d.youtubeDescriptionTemplate),
    youtubeTags: String(input.youtubeTags || d.youtubeTags),
    privacyStatus: pick(input.privacyStatus, ['private', 'unlisted', 'public'] as const, d.privacyStatus),
    language: String(input.language || d.language),
    aspectRatio: pick(input.aspectRatio, ['16:9', '9:16', '1:1'] as const, d.aspectRatio),
    resolution: pick(input.resolution, ['720p', '1080p'] as const, d.resolution),
    backgroundColor: String(input.backgroundColor || d.backgroundColor),
    accentColor: String(input.accentColor || d.accentColor),
    introMode: pick(input.introMode, ['none', 'generated', 'asset'] as const, d.introMode),
    introText: String(input.introText || d.introText),
    introDuration: num(input.introDuration, d.introDuration, 1, 30),
    introAssetPath: String(input.introAssetPath || ''),
    outroMode: pick(input.outroMode, ['none', 'generated', 'asset'] as const, d.outroMode),
    outroText: String(input.outroText || d.outroText),
    outroDuration: num(input.outroDuration, d.outroDuration, 1, 30),
    outroAssetPath: String(input.outroAssetPath || ''),
    lowerThirdEnabled: bool(input.lowerThirdEnabled, d.lowerThirdEnabled),
    lowerThirdText: String(input.lowerThirdText || d.lowerThirdText),
    useSourceImages: bool(input.useSourceImages, d.useSourceImages),
    thumbnailStyle: pick(input.thumbnailStyle, ['editorial', 'breaking', 'minimal', 'documentary', 'shorts'] as const, d.thumbnailStyle),
    callToAction: String(input.callToAction || d.callToAction),
    aiEnhancementEnabled: bool(input.aiEnhancementEnabled, d.aiEnhancementEnabled),
    aiScriptMode: pick(input.aiScriptMode, ['balanced', 'shorts', 'deepDive', 'breaking'] as const, d.aiScriptMode),
    aiTone: pick(input.aiTone, ['neutral', 'urgent', 'explainer', 'optimistic'] as const, d.aiTone),
    aiAudience: String(input.aiAudience || d.aiAudience),
    aiTargetDuration: num(input.aiTargetDuration, d.aiTargetDuration, 20, 600),
    aiIncludeChapters: bool(input.aiIncludeChapters, d.aiIncludeChapters),
    aiIncludeHook: bool(input.aiIncludeHook, d.aiIncludeHook),
    aiFactCheckPrompt: String(input.aiFactCheckPrompt || d.aiFactCheckPrompt),
    aiImagePromptStyle: String(input.aiImagePromptStyle || d.aiImagePromptStyle),
    aiSuggestedModels: String(input.aiSuggestedModels || d.aiSuggestedModels),
  };
}

export function getVideoDimensions(settings: VideoSettings) {
  const long = settings.resolution === '1080p' ? 1080 : 720;
  if (settings.aspectRatio === '9:16') return { width: Math.round(long * 9 / 16), height: long };
  if (settings.aspectRatio === '1:1') return { width: long, height: long };
  return { width: Math.round(long * 16 / 9), height: long };
}
