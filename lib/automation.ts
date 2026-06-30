import { spawn } from 'node:child_process';
import { getSettings, setSettings } from './db';

export type AutomationSettings = {
  enabled: boolean;
  intervalMinutes: number;
  crawl: boolean;
  maxArticles: number;
  baseUrl: string;
  cronInstalledAt?: string;
  cronLastResult?: string;
};

const DEFAULTS: AutomationSettings = {
  enabled: false,
  intervalMinutes: 30,
  crawl: true,
  maxArticles: 3,
  baseUrl: 'http://localhost:3000',
};

export function getAutomationSettings(): AutomationSettings {
  const settings = getSettings() as Record<string, unknown>;
  return {
    ...DEFAULTS,
    ...settings,
    enabled: settings.automationEnabled === true || settings.enabled === true,
    intervalMinutes: Number(settings.automationIntervalMinutes || settings.intervalMinutes || DEFAULTS.intervalMinutes),
    crawl: settings.automationCrawl !== false,
    maxArticles: Number(settings.automationMaxArticles || settings.maxArticles || DEFAULTS.maxArticles),
    baseUrl: String(settings.automationBaseUrl || settings.baseUrl || DEFAULTS.baseUrl),
  };
}

export function saveAutomationSettings(input: Record<string, unknown>) {
  const interval = Math.max(1, Math.min(1440, Number(input.intervalMinutes || input.automationIntervalMinutes || 30)));
  const maxArticles = Math.max(1, Math.min(20, Number(input.maxArticles || input.automationMaxArticles || 3)));
  setSettings({
    automationEnabled: input.enabled === 'on' || input.enabled === true || input.automationEnabled === true,
    automationIntervalMinutes: interval,
    automationCrawl: input.crawl === 'on' || input.crawl === true || input.automationCrawl === true,
    automationMaxArticles: maxArticles,
    automationBaseUrl: String(input.baseUrl || input.automationBaseUrl || DEFAULTS.baseUrl).replace(/\/$/, ''),
  });
}

export function buildCronLine(settings = getAutomationSettings()) {
  const schedule = `*/${settings.intervalMinutes} * * * *`;
  const payload = JSON.stringify({ crawl: settings.crawl, maxArticles: settings.maxArticles }).replace(/'/g, "'\\''");
  return `${schedule} curl -fsS -X POST '${settings.baseUrl}/api/workflow/run' -H 'content-type: application/json' -d '${payload}' >> /var/log/youtube-news-automation.log 2>&1 # youtube-news-studio`;
}

export async function installUserCron() {
  const settings = getAutomationSettings();
  const existing = await exec('sh', ['-c', 'crontab -l 2>/dev/null || true']);
  const lines = existing.stdout.split('\n').filter((line) => line.trim() && !line.includes('# youtube-news-studio'));
  if (settings.enabled) lines.push(buildCronLine(settings));
  await exec('crontab', ['-'], `${lines.join('\n')}\n`);
  const result = settings.enabled ? 'Benutzer-Cron installiert/aktualisiert.' : 'Benutzer-Cron entfernt.';
  setSettings({ cronInstalledAt: new Date().toISOString(), cronLastResult: result });
  return result;
}

export async function installRootCron(rootPassword?: string) {
  const settings = getAutomationSettings();
  const current = await exec('sh', ['-c', "sudo -S crontab -l 2>/dev/null || true"], rootPassword ? `${rootPassword}\n` : undefined);
  const lines = current.stdout.split('\n').filter((line) => line.trim() && !line.includes('# youtube-news-studio'));
  if (settings.enabled) lines.push(buildCronLine(settings));
  await exec('sudo', ['-S', 'crontab', '-'], `${rootPassword ? `${rootPassword}\n` : ''}${lines.join('\n')}\n`);
  const result = settings.enabled ? 'Root-Cron installiert/aktualisiert.' : 'Root-Cron entfernt.';
  setSettings({ cronInstalledAt: new Date().toISOString(), cronLastResult: result });
  return result;
}

function exec(cmd: string, args: string[], input?: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `${cmd} exited with ${code}`))));
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}
