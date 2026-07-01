import { getSettings, sql } from './db';

export type AiScenario = 'triage' | 'social' | 'drafting' | 'research' | 'strategy' | 'fact_check';
export type BillingTier = 'free' | 'paid' | 'local';

export type ModelRoute = {
  scenario: AiScenario;
  label: string;
  freeModel: string;
  model: string;
  paidFallback: boolean;
  inputPerMillion: number;
  outputPerMillion: number;
  maxTokens: number;
  purpose: string;
};

// Paid fallbacks are deliberately cheap. Every scenario attempts OpenRouter's zero-cost router first.
export const MODEL_ROUTES: ModelRoute[] = [
  { scenario: 'triage', label: 'Newsdesk / Triage', freeModel: 'openrouter/free', model: 'qwen/qwen3-30b-a3b-instruct-2507', paidFallback: false, inputPerMillion: 0.04815, outputPerMillion: 0.19305, maxTokens: 700, purpose: 'Clustering, Priorisierung und kurze Klassifikation' },
  { scenario: 'social', label: 'Social Publishing', freeModel: 'openrouter/free', model: 'mistralai/ministral-8b-2512', paidFallback: false, inputPerMillion: 0.15, outputPerMillion: 0.15, maxTokens: 900, purpose: 'Plattformvarianten, Hooks und kurze Texte' },
  { scenario: 'drafting', label: 'Autor / Skript', freeModel: 'openrouter/free', model: 'deepseek/deepseek-v3.2', paidFallback: false, inputPerMillion: 0.2288, outputPerMillion: 0.3432, maxTokens: 2600, purpose: 'Artikel, Videoskripte und Website-Fassungen' },
  { scenario: 'research', label: 'Recherche', freeModel: 'openrouter/free', model: 'google/gemini-2.5-flash-lite', paidFallback: false, inputPerMillion: 0.1, outputPerMillion: 0.4, maxTokens: 1800, purpose: 'Große Kontexte, Quellenvergleich und Briefings' },
  { scenario: 'strategy', label: 'Chefredaktion / Strategie', freeModel: 'openrouter/free', model: 'openai/gpt-4.1-mini', paidFallback: true, inputPerMillion: 0.4, outputPerMillion: 1.6, maxTokens: 1800, purpose: 'Ausführbare CEO-Entscheidungen und Kampagnenplanung' },
  { scenario: 'fact_check', label: 'Fakten & Risiko', freeModel: 'openrouter/free', model: 'anthropic/claude-haiku-4.5', paidFallback: true, inputPerMillion: 1, outputPerMillion: 5, maxTokens: 1400, purpose: 'Sensible Behauptungen, Gegenprüfung und Risiken' },
];

export type AiResult = {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  fallback: boolean;
  billingTier: BillingTier;
};

export function getAiPolicy() {
  const settings = getSettings() as Record<string, unknown>;
  return {
    enabled: settings.aiCompanyEnabled !== false,
    freeFirst: settings.aiFreeFirstEnabled !== false,
    paidFallbackEnabled: settings.aiPaidFallbackEnabled !== false,
    freeDailyRequestLimit: Math.max(1, Math.min(1000, Math.round(Number(settings.aiFreeDailyRequestLimit ?? 45)))),
    monthlyBudgetUsd: clamp(Number(settings.aiMonthlyBudgetUsd ?? 15), 0.1, 10_000),
    perRequestLimitUsd: clamp(Number(settings.aiPerRequestLimitUsd ?? 0.08), 0.001, 100),
    approvalThresholdUsd: clamp(Number(settings.aiApprovalThresholdUsd ?? 0.04), 0.001, 100),
    brandName: String(settings.brandName || 'YouTube News'),
    mission: String(settings.brandMission || 'Unabhängige Nachrichten verständlich einordnen und als Video, Livestream und Artikel veröffentlichen.'),
    audience: String(settings.brandAudience || 'Deutschsprachige Zuschauer, die schnelle Meldungen und nachvollziehbare Einordnung suchen.'),
    baseUrl: String(settings.automationBaseUrl || 'http://localhost:3000').replace(/\/$/, ''),
  };
}

export function getModelRoute(scenario: AiScenario): ModelRoute {
  const settings = getSettings() as Record<string, unknown>;
  const route = MODEL_ROUTES.find((entry) => entry.scenario === scenario) || MODEL_ROUTES[0];
  const paidOverride = String(settings[`aiModel_${scenario}`] || '').trim();
  const freeOverride = String(settings[`aiFreeModel_${scenario}`] || '').trim();
  const paidFallback = settings[`aiPaidFallback_${scenario}`] === undefined ? route.paidFallback : settings[`aiPaidFallback_${scenario}`] === true;
  return { ...route, model: paidOverride || route.model, freeModel: freeOverride || route.freeModel, paidFallback };
}

export function getAiSpend() {
  const month = new Date().toISOString().slice(0, 7);
  const day = new Date().toISOString().slice(0, 10);
  const row = sql.prepare("select coalesce(sum(costUsd),0) total, coalesce(sum(promptTokens),0) inputTokens, coalesce(sum(completionTokens),0) outputTokens, sum(case when billingTier='free' then 1 else 0 end) freeRequests, sum(case when billingTier='paid' then 1 else 0 end) paidRequests from ai_usage where substr(createdAt,1,7)=?").get(month) as { total: number; inputTokens: number; outputTokens: number; freeRequests: number; paidRequests: number };
  const daily = sql.prepare("select count(*) requests from ai_usage where billingTier='free' and substr(createdAt,1,10)=?").get(day) as { requests: number };
  return { month, day, totalUsd: Number(row.total || 0), promptTokens: Number(row.inputTokens || 0), completionTokens: Number(row.outputTokens || 0), freeRequests: Number(row.freeRequests || 0), paidRequests: Number(row.paidRequests || 0), dailyFreeRequests: Number(daily.requests || 0) };
}

export async function askOpenRouter(input: {
  scenario: AiScenario;
  system: string;
  prompt: string;
  fallback: string;
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: Record<string, unknown>;
  requirePaidQuality?: boolean;
  allowPaidFallback?: boolean;
}): Promise<AiResult> {
  const settings = getSettings() as Record<string, unknown>;
  const policy = getAiPolicy();
  const route = getModelRoute(input.scenario);
  const maxTokens = Math.min(input.maxTokens || route.maxTokens, route.maxTokens);
  if (!policy.enabled || !settings.openRouterKey) return fallbackResult(input.fallback, route.freeModel, 'local');

  let freeError = '';
  const freeUsedToday = getAiSpend().dailyFreeRequests;
  if (policy.freeFirst && !input.requirePaidQuality && freeUsedToday < policy.freeDailyRequestLimit) {
    try {
      return await performRequest(input, route.freeModel, maxTokens, 'free', settings, policy.baseUrl, policy.brandName, route);
    } catch (error) {
      freeError = error instanceof Error ? error.message : 'Free Router nicht verfügbar';
    }
  } else if (policy.freeFirst && !input.requirePaidQuality) {
    freeError = `lokales Free-Tageslimit ${policy.freeDailyRequestLimit} erreicht`;
  }

  const paidAllowed = policy.paidFallbackEnabled && route.paidFallback && (input.allowPaidFallback === true || input.requirePaidQuality === true);
  if (!paidAllowed) {
    const paidReason = !route.paidFallback || !policy.paidFallbackEnabled ? 'ist deaktiviert' : 'wurde für diese Anfrage nicht als kritisch freigegeben';
    const reason = freeError ? `Free Router nicht verfügbar (${freeError}); Paid-Fallback für ${route.label} ${paidReason}.` : `Paid-Fallback für ${route.label} ${paidReason}.`;
    return fallbackResult(`${input.fallback}\n\n[${reason} Lokale Verarbeitung verwendet.]`, route.freeModel, 'local');
  }

  const estimatedPromptTokens = Math.ceil((input.system.length + input.prompt.length) / 3.5);
  const estimatedCost = estimatedPromptTokens / 1_000_000 * route.inputPerMillion + maxTokens / 1_000_000 * route.outputPerMillion;
  const spent = getAiSpend().totalUsd;
  if (estimatedCost > policy.perRequestLimitUsd) return fallbackResult(`${input.fallback}\n\n[Paid-Fallback blockiert: ${money(estimatedCost)} über Einzellimit.]`, route.model, 'local');
  if (estimatedCost > policy.approvalThresholdUsd && !input.requirePaidQuality) return fallbackResult(`${input.fallback}\n\n[Paid-Fallback benötigt CEO-Freigabe: ${money(estimatedCost)}.]`, route.model, 'local');
  if (spent + estimatedCost > policy.monthlyBudgetUsd) return fallbackResult(`${input.fallback}\n\n[Monatsbudget erreicht; lokale Verarbeitung verwendet.]`, route.model, 'local');

  try {
    return await performRequest(input, route.model, maxTokens, 'paid', settings, policy.baseUrl, policy.brandName, route);
  } catch (error) {
    const paidError = error instanceof Error ? error.message : 'unbekannter Fehler';
    return fallbackResult(`${input.fallback}\n\n[Free- und Paid-Router nicht verfügbar: ${freeError || 'übersprungen'}; ${paidError}. Lokale Verarbeitung verwendet.]`, route.model, 'local');
  }
}

async function performRequest(
  input: Parameters<typeof askOpenRouter>[0],
  model: string,
  maxTokens: number,
  billingTier: Exclude<BillingTier, 'local'>,
  settings: Record<string, unknown>,
  baseUrl: string,
  brandName: string,
  route: ModelRoute,
) {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }],
    temperature: input.temperature ?? 0.35,
    max_tokens: maxTokens,
    usage: { include: true },
  };
  if (input.jsonSchema) body.response_format = { type: 'json_schema', json_schema: { name: `${input.scenario}_result`, strict: true, schema: input.jsonSchema } };
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(billingTier === 'free' ? 90_000 : 60_000),
    headers: { Authorization: `Bearer ${settings.openRouterKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': baseUrl, 'X-OpenRouter-Title': `${brandName} Redaktion` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OpenRouter ${billingTier} HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const json = await response.json() as { model?: string; choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error(`OpenRouter ${billingTier} lieferte keine Antwort.`);
  const promptTokens = Number(json.usage?.prompt_tokens || Math.ceil((input.system.length + input.prompt.length) / 3.5));
  const completionTokens = Number(json.usage?.completion_tokens || Math.ceil(content.length / 3.5));
  const costUsd = billingTier === 'free' ? 0 : Number(json.usage?.cost ?? (promptTokens / 1_000_000 * route.inputPerMillion + completionTokens / 1_000_000 * route.outputPerMillion));
  sql.prepare('insert into ai_usage(scenario,model,promptTokens,completionTokens,costUsd,billingTier,createdAt) values(?,?,?,?,?,?,CURRENT_TIMESTAMP)').run(input.scenario, json.model || model, promptTokens, completionTokens, costUsd, billingTier);
  return { content, model: json.model || model, promptTokens, completionTokens, costUsd, fallback: false, billingTier } satisfies AiResult;
}

function fallbackResult(content: string, model: string, billingTier: BillingTier): AiResult {
  return { content, model, promptTokens: 0, completionTokens: 0, costUsd: 0, fallback: true, billingTier };
}

function clamp(value: number, min: number, max: number) { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min; }
function money(value: number) { return `$${value.toFixed(4)}`; }
