export type AIProviderId =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'custom';

export interface AIConfig {
  provider: AIProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  baseUrl?: string;
  /**
   * Public catalog endpoint that lists the model ids this provider currently
   * serves. Used to reject a configured-but-unavailable model as a
   * configuration error instead of letting the request fail at the provider.
   */
  modelCatalog?: string;
}

export const AI_PROVIDERS: AIProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-opus-4-1',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    keyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.0-flash',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    // Retired models (e.g. anthropic/claude-3.5-sonnet) are rejected up front
    // by the model check in `validateModel`, so the default has to name a model
    // OpenRouter still serves. It is only a fallback: OPENROUTER_MODEL wins.
    defaultModel: 'anthropic/claude-sonnet-4',
    modelCatalog: 'https://openrouter.ai/api/v1/models',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    keyEnv: 'AI_API_KEY',
    modelEnv: 'AI_MODEL',
    defaultModel: 'gpt-4o-mini',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
];

function env(k: string): string | undefined {
  const v = process.env[k];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Reject values that are obviously stand-ins rather than real credentials.
 *
 * `.env.example` ships `sk-xxxxx` / `your-key-here` style placeholders, and
 * those are non-empty, so a naive truthiness check treats them as configured
 * and the failure only surfaces as an opaque 500 from the provider. Detecting
 * them up front lets the app report a configuration error instead.
 *
 * The real value is never logged, only whether it passed.
 */
export function isUsableApiKey(value: string | undefined): boolean {
  if (!value) return false;
  const key = value.trim();
  if (key.length < 20) return false;
  // Everything after the first separator is filler, e.g. "sk-xxxxxxxxxxxx".
  const tail = key.includes('-') ? key.slice(key.indexOf('-') + 1) : key;
  const isPlaceholder =
    /^(x{4,}|\.{3,}|y{4,}|z{4,}|changeme|placeholder|your[-_ ]?(key|token|secret)?|todo|replace[-_ ]?me|example|dummy|fake|test|secret|abc123|12345+|none|null|undefined)$/i.test(
      tail
    ) ||
    // A key made of a single repeated character.
    /^(.)\1{7,}$/.test(tail);
  return !isPlaceholder;
}

export function getAIConfig(): AIConfig | null {
  return selectAIConfig().config;
}

function selectAIConfig(): { config: AIConfig | null; rejected: string[] } {
  const requested = (env('AI_PROVIDER') || 'auto').toLowerCase();
  const rejected: string[] = [];

  let selected: AIProviderInfo | null = null;
  let apiKey: string | undefined;

  const consider = (info: AIProviderInfo, key: string | undefined) => {
    if (!key) return;
    if (!isUsableApiKey(key)) {
      // Record the env var name only - never the value.
      rejected.push(info.keyEnv);
      return;
    }
    selected = info;
    apiKey = key;
  };

  if (requested !== 'auto') {
    if (requested === 'custom') {
      consider(AI_PROVIDERS[4], env('AI_API_KEY'));
    } else {
      for (const p of AI_PROVIDERS) {
        if (p.id === requested) {
          consider(p, env(p.keyEnv));
          break;
        }
      }
    }
  } else {
    // Auto-detect: pick the first provider with a *usable* key configured.
    //
    // An explicitly configured OpenAI-compatible endpoint (AI_API_KEY together
    // with AI_BASE_URL) is a deliberate choice, so it outranks the generic
    // auto-detection order. Without this, any stray dedicated-provider key wins
    // and AI_BASE_URL is silently ignored - the app then talks to a provider
    // the operator never pointed it at and fails on that provider's model list.
    const ordered: AIProviderInfo[] = [];
    if (env('AI_BASE_URL')) ordered.push(AI_PROVIDERS[4]); // custom, explicit
    for (const p of AI_PROVIDERS) {
      if (p.id !== 'custom') ordered.push(p);
    }
    if (!env('AI_BASE_URL')) ordered.push(AI_PROVIDERS[4]);

    for (const p of ordered) {
      const key = env(p.keyEnv);
      if (!key) continue;
      if (isUsableApiKey(key)) {
        selected = p;
        apiKey = key;
        break;
      }
      rejected.push(p.keyEnv);
    }
  }

  if (!selected || !apiKey) return { config: null, rejected };

  const model =
    env(selected.modelEnv) || env('AI_MODEL') || selected.defaultModel;

  return {
    config: {
      provider: selected.id,
      apiKey,
      model,
      baseUrl: selected.baseUrl ? env('AI_BASE_URL') || selected.baseUrl : undefined,
    },
    rejected,
  };
}

/** Human-readable explanation of why no provider could be used. */
export function describeMissingAIConfig(rejected: string[] = []): string {
  const base =
    'No usable AI provider is configured. Set a real API key for one of: ' +
    AI_PROVIDERS.map((p) => p.keyEnv).join(', ') +
    '.';
  if (rejected.length === 0) return base;
  return (
    base +
    ' These are set but look like placeholders: ' +
    rejected.join(', ') +
    '.'
  );
}

export const AI_CONFIG_ERROR_CODE = 'AI_PROVIDER_NOT_CONFIGURED';

/**
 * A provider/model that cannot work. Distinct from a generation failure so the
 * API can answer with an actionable 503 instead of an opaque 500, and so no
 * caller ever substitutes placeholder content for real generated text.
 */
export class AIProviderConfigError extends Error {
  readonly code = AI_CONFIG_ERROR_CODE;
  readonly provider: AIProviderId | null;
  readonly model: string | null;
  readonly status = 503;

  constructor(message: string, provider: AIProviderId | null = null, model: string | null = null) {
    super(message);
    this.name = 'AIProviderConfigError';
    this.provider = provider;
    this.model = model;
  }
}

/* -------------------------------------------------------------------------- */
/* Model availability                                                          */
/* -------------------------------------------------------------------------- */

const CATALOG_TTL_MS = 10 * 60 * 1000;
/** Ceiling on a single provider request, so generation cannot hang a request. */
const AI_REQUEST_TIMEOUT_MS = 90_000;
const catalogCache = new Map<string, { ids: string[]; at: number }>();

/**
 * Model ids a provider currently serves, or `null` when the catalog could not be
 * read (offline, rate-limited, provider down).
 *
 * `null` means "unknown" and callers must fall through to the real request —
 * failing closed here would take down a working configuration every time
 * OpenRouter's public catalog hiccups.
 */
async function fetchModelCatalog(url: string): Promise<string[] | null> {
  const cached = catalogCache.get(url);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.ids;

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) return null;
    catalogCache.set(url, { ids, at: Date.now() });
    return ids;
  } catch {
    return null;
  }
}

/** A few ids from the same family, so a fix can be copy/pasted. */
function suggestModels(ids: string[], model: string): string[] {
  const vendor = model.split('/')[0]?.toLowerCase();
  const sameVendor = ids.filter((id) => id.toLowerCase().startsWith(`${vendor}/`));
  const pool = sameVendor.length >= 3 ? sameVendor : ids;
  return pool
    .filter((id) => id !== model)
    .slice(0, 5);
}

export type ModelValidation =
  | { ok: true; checked: boolean }
  | { ok: false; message: string };

/**
 * Is the configured model one this provider can actually run?
 *
 * A key without a reachable model is the single most common misconfiguration
 * and it used to surface as a provider 500 ("No endpoints found for
 * anthropic/claude-3.5-sonnet"). Checking the provider's own catalog first
 * turns that into a configuration error naming the variable to fix.
 */
export async function validateModel(config: AIConfig): Promise<ModelValidation> {
  const info = AI_PROVIDERS.find((p) => p.id === config.provider);
  if (!info?.modelCatalog) {
    // No catalog to check against: only reject an obviously malformed value.
    if (!config.model || /\s/.test(config.model)) {
      return {
        ok: false,
        message: `${info?.modelEnv ?? 'AI_MODEL'} is set to an invalid model id (${JSON.stringify(
          config.model
        )}). Set ${info?.modelEnv ?? 'AI_MODEL'} to a real model id.`,
      };
    }
    return { ok: true, checked: false };
  }

  const ids = await fetchModelCatalog(info.modelCatalog);
  if (!ids) return { ok: true, checked: false };

  if (ids.includes(config.model)) return { ok: true, checked: true };

  const suggestions = suggestModels(ids, config.model);
  return {
    ok: false,
    message:
      `${info.modelEnv} is set to "${config.model}", which ${info.label} does not serve ` +
      `(no such model in its catalog). Set ${info.modelEnv} to a model that exists` +
      (suggestions.length ? `, for example: ${suggestions.join(', ')}.` : '.'),
  };
}

export interface ResolvedAIConfig {
  config: AIConfig | null;
  /** Present when a provider/key/model was found but cannot be used. */
  configError: string | null;
  rejected: string[];
  modelChecked: boolean;
}

/**
 * The full configuration check, including model availability. This is what
 * callers should use before attempting generation.
 */
export async function resolveAIConfig(): Promise<ResolvedAIConfig> {
  const { config, rejected } = selectAIConfig();
  if (!config) {
    return { config: null, configError: describeMissingAIConfig(rejected), rejected, modelChecked: false };
  }

  const validation = await validateModel(config);
  if (!validation.ok) {
    return { config: null, configError: validation.message, rejected, modelChecked: true };
  }
  return {
    config,
    configError: null,
    rejected,
    modelChecked: validation.checked,
  };
}

/** Provider failures that mean "this configuration cannot work", not "try again". */
const CONFIG_FAILURE_PATTERNS = [
  /no endpoints found/i,
  /model[_ ]?not[_ ]?found/i,
  /no model found/i,
  /unknown model/i,
  /is not a valid model/i,
  /\b(401|403)\b/,
  /invalid[ _]api[_ ]key/i,
  /authentication/i,
  /no auth credentials found/i,
  // The key works but the account cannot fund the request. Still a
  // configuration/account problem to report as 503 with the fix — not a 500,
  // and never a reason to invent content.
  /requires more credits/i,
  /insufficient[ _]quota/i,
  /exceeded your current quota/i,
  /billing|hard credit limit|upgrade to a paid account/i,
];

function isConfigFailure(message: string): boolean {
  return CONFIG_FAILURE_PATTERNS.some((re) => re.test(message));
}


export interface AIStatus {
  configured: boolean;
  provider: AIProviderId | null;
  label: string | null;
  model: string | null;
  baseUrl: string | null;
  supported: string[];
  /** Env var names that are set but hold obvious placeholders. */
  placeholderKeys: string[];
  reason: string | null;
  /** True once the provider's model catalog confirmed the model exists. */
  modelVerified?: boolean;
}

export function getAIStatus(): AIStatus {
  const { config, rejected } = selectAIConfig();
  if (!config) {
    return {
      configured: false,
      provider: null,
      label: null,
      model: null,
      baseUrl: null,
      supported: AI_PROVIDERS.map((p) => p.id),
      placeholderKeys: rejected,
      reason: describeMissingAIConfig(rejected),
    };
  }
  const info = AI_PROVIDERS.find((p) => p.id === config.provider)!;
  return {
    configured: true,
    provider: config.provider,
    label: info.label,
    model: config.model,
    baseUrl: config.baseUrl || null,
    supported: AI_PROVIDERS.map((p) => p.id),
    placeholderKeys: [],
    reason: null,
  };
}

/**
 * `getAIStatus` plus the model-availability check, so a configured-but-dead
 * model is reported as unconfigured instead of as a working provider.
 */
export async function getAIStatusAsync(): Promise<AIStatus> {
  const { config, configError, rejected, modelChecked } = await resolveAIConfig();
  if (!config) {
    return {
      configured: false,
      provider: null,
      label: null,
      model: null,
      baseUrl: null,
      supported: AI_PROVIDERS.map((p) => p.id),
      placeholderKeys: rejected,
      reason: configError ?? describeMissingAIConfig(rejected),
      modelVerified: false,
    };
  }
  const info = AI_PROVIDERS.find((p) => p.id === config.provider)!;
  return {
    configured: true,
    provider: config.provider,
    label: info.label,
    model: config.model,
    baseUrl: config.baseUrl || null,
    supported: AI_PROVIDERS.map((p) => p.id),
    placeholderKeys: [],
    reason: null,
    modelVerified: modelChecked,
  };
}

export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; config?: AIConfig } = {}
): Promise<string> {
  const config = options.config || getAIConfig();
  if (!config) {
    throw new AIProviderConfigError(
      describeMissingAIConfig(selectAIConfig().rejected)
    );
  }

  const maxTokens = options.maxTokens || 2000;

  // Provider failures ("no endpoints for <model>", 401, 403) are almost always
  // a configuration problem, so name the provider/model that was actually used.
  // The API key is never included.
  try {
    switch (config.provider) {
      case 'anthropic':
        return await generateAnthropic(config, systemPrompt, userPrompt, maxTokens);
      case 'openai':
        return await generateChatCompletions(
          'https://api.openai.com/v1',
          config,
          systemPrompt,
          userPrompt,
          maxTokens
        );
      case 'openrouter':
        return await generateChatCompletions(
          'https://openrouter.ai/api/v1',
          config,
          systemPrompt,
          userPrompt,
          maxTokens
        );
      case 'gemini':
        return await generateGemini(config, systemPrompt, userPrompt, maxTokens);
      case 'custom': {
        const baseUrl = config.baseUrl?.replace(/\/$/, '');
        if (!baseUrl) {
          throw new Error('AI_BASE_URL is required for the custom provider');
        }
        return await generateChatCompletions(
          baseUrl,
          config,
          systemPrompt,
          userPrompt,
          maxTokens
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const info = AI_PROVIDERS.find((p) => p.id === config.provider);
    const detail =
      `${message} (provider=${config.provider}, model=${config.model}` +
      `${config.baseUrl ? `, baseUrl=${config.baseUrl}` : ''})`;
    // A key/model that the provider cannot serve must read as a configuration
    // problem (503 + the variable to fix), never as a server error — and never
    // as a reason to invent content.
    if (isConfigFailure(message)) {
      throw new AIProviderConfigError(
        `AUTO-REPURPOSE BLOCKED: ${info?.label ?? config.provider} rejected the ` +
          `request for model "${config.model}". Set ${info?.modelEnv ?? 'AI_MODEL'} ` +
          `to a model this key can reach, or set a real ${info?.keyEnv ?? 'AI_API_KEY'}. ` +
          `Provider said: ${message}`,
        config.provider,
        config.model
      );
    }
    throw new Error(detail);
  }
}

async function request(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // A provider that never answers must not hold the request open forever.
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const aborted =
      (err as { name?: string })?.name === 'TimeoutError' ||
      (err as { name?: string })?.name === 'AbortError';
    throw new Error(
      aborted
        ? `AI provider did not answer within ${Math.round(
            AI_REQUEST_TIMEOUT_MS / 1000
          )}s`
        : `Could not reach AI provider at ${url}`
    );
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (data && (data.error?.message || data.message)) ||
      `Request failed with status ${res.status}`;
    throw new Error(`AI provider error: ${message}`);
  }

  return data;
}

async function generateAnthropic(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const data = await request(
    'https://api.anthropic.com/v1/messages',
    {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }
  );

  const text = (data.content || [])
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('');

  if (!text) throw new Error('AI provider returned no text');
  return text;
}

async function generateChatCompletions(
  baseUrl: string,
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const data = await request(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    {
      model: config.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }
  );

  const text = (data.choices || [])
    .map((choice: any) => choice.message?.content)
    .filter(Boolean)
    .join('');

  if (!text) throw new Error('AI provider returned no text');
  return text;
}

async function generateGemini(
  config: AIConfig,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    config.model
  )}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  const data = await request(
    url,
    { 'content-type': 'application/json' },
    {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: { maxOutputTokens: maxTokens },
    }
  );

  const text = ((data.candidates || [])[0]?.content?.parts || [])
    .map((part: any) => part.text)
    .filter(Boolean)
    .join('');

  if (!text) throw new Error('AI provider returned no text');
  return text;
}

/** Strips a ```json ... ``` fence if the provider wraps the output in one. */
export function parseAIJSON<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  return JSON.parse(text) as T;
}