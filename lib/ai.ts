import { getSettings, sql } from './db';

export type AiScenario = 'triage' | 'social' | 'drafting' | 'research' | 'strategy' | 'fact_check';

export type ModelRoute = {
  scenario: AiScenario;
  label: string;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  maxTokens: number;
  purpose: string;
};

// Price snapshot from OpenRouter's model API, checked 2026-07-01. Admins can override every route.
export const MODEL_ROUTES: ModelRoute[] = [
  { scenario: 'triage', label: 'Newsdesk / Triage', model: 'qwen/qwen3-30b-a3b-instruct-2507', inputPerMillion: 0.04815, outputPerMillion: 0.19305, maxTokens: 700, purpose: 'Clustering, Priorisierung und kurze Klassifikation' },
  { scenario: 'social', label: 'Social Publishing', model: 'mistralai/ministral-8b-2512', inputPerMillion: 0.15, outputPerMillion: 0.15, maxTokens: 900, purpose: 'Plattformvarianten, Hooks und kurze Texte' },
  { scenario: 'drafting', label: 'Autor / Skript', model: 'deepseek/deepseek-v3.2', inputPerMillion: 0.2288, outputPerMillion: 0.3432, maxTokens: 2600, purpose: 'Artikel, Videoskripte und Website-Fassungen' },
  { scenario: 'research', label: 'Recherche', model: 'google/gemini-2.5-flash-lite', inputPerMillion: 0.1, outputPerMillion: 0.4, maxTokens: 1800, purpose: 'Große Kontexte, Quellenvergleich und Briefings' },
  { scenario: 'strategy', label: 'Chefredaktion / Strategie', model: 'openai/gpt-4.1-mini', inputPerMillion: 0.4, outputPerMillion: 1.6, maxTokens: 1800, purpose: 'Entscheidungen, Kampagnen und Redaktionsplanung' },
  { scenario: 'fact_check', label: 'Fakten & Risiko', model: 'anthropic/claude-haiku-4.5', inputPerMillion: 1, outputPerMillion: 5, maxTokens: 1400, purpose: 'Sensible Behauptungen, Gegenprüfung und Risiken' },
];

export type AiResult = {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  fallback: boolean;
};

export function getAiPolicy() {
  const settings = getSettings() as Record<string, unknown>;
  return {
    enabled: settings.aiCompanyEnabled !== false,
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
  const override = String(settings[`aiModel_${scenario}`] || '').trim();
  return { ...route, model: override || route.model };
}

export function getAiSpend() {
  const month = new Date().toISOString().slice(0, 7);
  const row = sql.prepare("select coalesce(sum(costUsd),0) total, coalesce(sum(promptTokens),0) inputTokens, coalesce(sum(completionTokens),0) outputTokens from ai_usage where substr(createdAt,1,7)=?").get(month) as { total: number; inputTokens: number; outputTokens: number };
  return { month, totalUsd: Number(row.total || 0), promptTokens: Number(row.inputTokens || 0), completionTokens: Number(row.outputTokens || 0) };
}

export async function askOpenRouter(input: {
  scenario: AiScenario;
  system: string;
  prompt: string;
  fallback: string;
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: Record<string, unknown>;
}): Promise<AiResult> {
  const settings = getSettings() as Record<string, unknown>;
  const policy = getAiPolicy();
  const route = getModelRoute(input.scenario);
  const maxTokens = Math.min(input.maxTokens || route.maxTokens, route.maxTokens);
  const estimatedPromptTokens = Math.ceil((input.system.length + input.prompt.length) / 3.5);
  const estimatedCost = estimatedPromptTokens / 1_000_000 * route.inputPerMillion + maxTokens / 1_000_000 * route.outputPerMillion;
  const spent = getAiSpend().totalUsd;

  if (!policy.enabled || !settings.openRouterKey) return fallbackResult(input.fallback, route.model);
  if (estimatedCost > policy.perRequestLimitUsd) return fallbackResult(`${input.fallback}\n\n[KI-Anfrage lokal beantwortet: geschätzte Kosten ${money(estimatedCost)} übersteigen das Einzellimit.]`, route.model);
  if (estimatedCost > policy.approvalThresholdUsd) return fallbackResult(`${input.fallback}\n\n[KI-Anfrage lokal beantwortet: geschätzte Kosten ${money(estimatedCost)} benötigen laut Richtlinie eine CEO-Freigabe. Schwelle: ${money(policy.approvalThresholdUsd)}.]`, route.model);
  if (spent + estimatedCost > policy.monthlyBudgetUsd) return fallbackResult(`${input.fallback}\n\n[Monatsbudget erreicht; keine kostenpflichtige KI-Anfrage ausgeführt.]`, route.model);

  try {
    const body: Record<string, unknown> = {
      model: route.model,
      messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }],
      temperature: input.temperature ?? 0.35,
      max_tokens: maxTokens,
      usage: { include: true },
    };
    if (input.jsonSchema) body.response_format = { type: 'json_schema', json_schema: { name: `${input.scenario}_result`, strict: true, schema: input.jsonSchema } };
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${settings.openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': policy.baseUrl,
        'X-OpenRouter-Title': `${policy.brandName} Redaktion`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    const json = await response.json() as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('OpenRouter lieferte keine Antwort.');
    const promptTokens = Number(json.usage?.prompt_tokens || estimatedPromptTokens);
    const completionTokens = Number(json.usage?.completion_tokens || Math.ceil(content.length / 3.5));
    const costUsd = Number(json.usage?.cost ?? (promptTokens / 1_000_000 * route.inputPerMillion + completionTokens / 1_000_000 * route.outputPerMillion));
    sql.prepare('insert into ai_usage(scenario,model,promptTokens,completionTokens,costUsd,createdAt) values(?,?,?,?,?,CURRENT_TIMESTAMP)').run(input.scenario, json.model || route.model, promptTokens, completionTokens, costUsd);
    return { content, model: json.model || route.model, promptTokens, completionTokens, costUsd, fallback: false };
  } catch (error) {
    return fallbackResult(`${input.fallback}\n\n[OpenRouter nicht verfügbar: ${error instanceof Error ? error.message : 'unbekannter Fehler'}]`, route.model);
  }
}

function fallbackResult(content: string, model: string): AiResult {
  return { content, model, promptTokens: 0, completionTokens: 0, costUsd: 0, fallback: true };
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function money(value: number) {
  return `$${value.toFixed(4)}`;
}
