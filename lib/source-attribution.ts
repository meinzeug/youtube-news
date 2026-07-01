export function sourceLabel(url: string, preferredName = '') {
  if (preferredName.trim()) return preferredName.trim();
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'der Originalquelle';
  }
}

export function ensureSourceAttribution(description: string, sourceName: string, sourceUrl: string) {
  const escapedUrl = sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutDuplicateUrl = description.replace(new RegExp(escapedUrl, 'g'), '');
  const cleaned = withoutDuplicateUrl
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:quelle|originalbeitrag|weiterlesen|mehr hintergründe)\b/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4400);
  const credit = `Mehr Hintergründe und den vollständigen Originalbeitrag findet ihr direkt bei ${sourceName}:\n${sourceUrl}`;
  return [cleaned, credit].filter(Boolean).join('\n\n');
}
