import { spawn } from 'node:child_process';
import path from 'node:path';
import { getSettings, setSettings } from './db';

export type AutomationSettings = {
  enabled: boolean;
  intervalMinutes: number;
  crawl: boolean;
  maxArticles: number;
  campaignOnly: boolean;
  baseUrl: string;
  cronScope: 'user' | 'root';
  cronInstalledAt?: string;
  cronLastResult?: string;
  cronLastError?: string;
};

export type AutomationStatus = AutomationSettings & {
  cronLine: string;
  nextRunHint: string;
  userCrontabActive: boolean;
  rootCrontabActive: boolean;
  userCrontabAvailable: boolean;
  sudoAvailable: boolean;
  effectiveUser: string;
};

const DEFAULTS: AutomationSettings = {
  enabled: false,
  intervalMinutes: 30,
  crawl: true,
  maxArticles: 3,
  campaignOnly: false,
  baseUrl: 'http://localhost:3000',
  cronScope: 'user',
};

const MARKER = '# youtube-news-studio';

export function getAutomationSettings(): AutomationSettings {
  const settings = getSettings() as Record<string, unknown>;
  const scope = settings.automationCronScope === 'root' || settings.cronScope === 'root' ? 'root' : 'user';
  return {
    ...DEFAULTS,
    ...settings,
    enabled: settings.automationEnabled === true || settings.enabled === true,
    intervalMinutes: Number(settings.automationIntervalMinutes || settings.intervalMinutes || DEFAULTS.intervalMinutes),
    crawl: settings.automationCrawl !== false,
    maxArticles: Number(settings.automationMaxArticles || settings.maxArticles || DEFAULTS.maxArticles),
    campaignOnly: settings.automationCampaignOnly === true,
    baseUrl: String(settings.automationBaseUrl || settings.baseUrl || DEFAULTS.baseUrl),
    cronScope: scope,
    cronInstalledAt: String(settings.cronInstalledAt || ''),
    cronLastResult: String(settings.cronLastResult || ''),
    cronLastError: String(settings.cronLastError || ''),
  };
}

export function saveAutomationSettings(input: Record<string, unknown>) {
  const interval = Math.max(1, Math.min(1440, Number(input.intervalMinutes || input.automationIntervalMinutes || 30)));
  const maxArticles = Math.max(1, Math.min(20, Number(input.maxArticles || input.automationMaxArticles || 3)));
  const baseUrl = String(input.baseUrl || input.automationBaseUrl || DEFAULTS.baseUrl).trim().replace(/\/$/, '');
  const cronScope = input.scope === 'root' || input.cronScope === 'root' ? 'root' : 'user';
  setSettings({
    automationEnabled: input.enabled === 'on' || input.enabled === true || input.automationEnabled === true,
    automationIntervalMinutes: interval,
    automationCrawl: input.crawl === 'on' || input.crawl === true || input.automationCrawl === true,
    automationMaxArticles: maxArticles,
    automationCampaignOnly: input.campaignOnly === 'on' || input.campaignOnly === true || input.automationCampaignOnly === true,
    automationBaseUrl: baseUrl || DEFAULTS.baseUrl,
    automationCronScope: cronScope,
  });
}

export function buildCronLine(settings = getAutomationSettings()) {
  const schedule = `*/${settings.intervalMinutes} * * * *`;
  const payload = JSON.stringify({ crawl: settings.crawl, maxArticles: settings.maxArticles, campaigns: true, campaignOnly: settings.campaignOnly }).replace(/'/g, "'\\''");
  const url = shellQuote(`${settings.baseUrl}/api/workflow/run`);
  const logFile = shellQuote(path.join(process.cwd(), 'data', 'automation.log'));
  return `${schedule} (curl -fsS -X POST ${url} -H 'content-type: application/json' -d '${payload}'; printf '\\n') >> ${logFile} 2>&1 ${MARKER}`;
}

export function nextRunHint(settings = getAutomationSettings(), now = new Date()) {
  if (!settings.enabled) return 'Automatisierung ist deaktiviert.';
  const minutes = now.getMinutes();
  const wait = settings.intervalMinutes - (minutes % settings.intervalMinutes || settings.intervalMinutes);
  const next = new Date(now.getTime() + (wait || settings.intervalMinutes) * 60_000);
  next.setSeconds(0, 0);
  return `Nächster Lauf ungefähr ${next.toLocaleString('de-DE')} (Serverzeit).`;
}

export async function getAutomationStatus(): Promise<AutomationStatus> {
  const settings = getAutomationSettings();
  const [userCron, rootCron, sudoCheck, whoami] = await Promise.all([
    exec('sh', ['-c', 'command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null || true']).catch(() => ({ stdout: '', stderr: '' })),
    exec('sh', ['-c', 'command -v sudo >/dev/null 2>&1 && sudo -n crontab -l 2>/dev/null || true']).catch(() => ({ stdout: '', stderr: '' })),
    exec('sh', ['-c', 'command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1 && echo yes || echo no']).catch(() => ({ stdout: 'no', stderr: '' })),
    exec('sh', ['-c', 'whoami 2>/dev/null || id -un']).catch(() => ({ stdout: 'unknown', stderr: '' })),
  ]);
  return {
    ...settings,
    cronLine: buildCronLine(settings),
    nextRunHint: nextRunHint(settings),
    userCrontabActive: userCron.stdout.includes(MARKER),
    rootCrontabActive: rootCron.stdout.includes(MARKER),
    userCrontabAvailable: userCron.stderr.length === 0,
    sudoAvailable: sudoCheck.stdout.trim() === 'yes',
    effectiveUser: whoami.stdout.trim(),
  };
}

export async function installUserCron() {
  const settings = getAutomationSettings();
  const existing = await exec('sh', ['-c', 'crontab -l 2>/dev/null || true']);
  const lines = existing.stdout.split('\n').filter((line) => line.trim() && !line.includes(MARKER));
  if (settings.enabled) lines.push(buildCronLine(settings));
  await exec('crontab', ['-'], `${lines.join('\n')}\n`);
  const result = settings.enabled ? 'Benutzer-Cron installiert/aktualisiert.' : 'Benutzer-Cron entfernt.';
  setSettings({ cronInstalledAt: new Date().toISOString(), cronLastResult: result, cronLastError: '' });
  return result;
}

export async function installRootCron(rootPassword?: string) {
  const settings = getAutomationSettings();
  if (!rootPassword) throw new Error('Für Root-Crontab ist ein sudo/root-Passwort erforderlich. Es wird nicht gespeichert. Alternativ Benutzer-Crontab wählen.');
  const current = await exec('sh', ['-c', 'sudo -S -p "" crontab -l 2>/dev/null || true'], `${rootPassword}\n`);
  const lines = current.stdout.split('\n').filter((line) => line.trim() && !line.includes(MARKER));
  if (settings.enabled) lines.push(buildCronLine(settings));
  await exec('sudo', ['-S', '-p', '', 'crontab', '-'], `${rootPassword}\n${lines.join('\n')}\n`);
  const result = settings.enabled ? 'Root-Cron installiert/aktualisiert.' : 'Root-Cron entfernt.';
  setSettings({ cronInstalledAt: new Date().toISOString(), cronLastResult: result, cronLastError: '' });
  return result;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
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
