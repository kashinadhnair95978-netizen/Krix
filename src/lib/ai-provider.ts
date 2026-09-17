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
    defaultModel: 'anthropic/claude-3.5-sonnet',
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

export function getAIConfig(): AIConfig | null {
  const requested = (env('AI_PROVIDER') || 'auto').toLowerCase();

  let selected: AIProviderInfo | null = null;
  let apiKey: string | undefined;

  if (requested !== 'auto') {
    if (requested === 'custom') {
      selected = AI_PROVIDERS[4];
      apiKey = env('AI_API_KEY');
    } else {
      for (const p of AI_PROVIDERS) {
        if (p.id === requested) {
          selected = p;
          apiKey = env(p.keyEnv);
          break;
        }
      }
    }
  } else {
    // Auto-detect: pick the first provider with a key configured.
    for (const p of AI_PROVIDERS) {
      const key = env(p.keyEnv);
      if (key) {
        selected = p;
        apiKey = key;
        break;
      }
    }
  }

  if (!selected || !apiKey) return null;

  const model =
    env(selected.modelEnv) || env('AI_MODEL') || selected.defaultModel;

  return {
    provider: selected.id,
    apiKey,
    model,
    baseUrl: selected.baseUrl ? env('AI_BASE_URL') || selected.baseUrl : undefined,
  };
}

export interface AIStatus {
  configured: boolean;
  provider: AIProviderId | null;
  label: string | null;
  model: string | null;
  baseUrl: string | null;
  supported: string[];
}

export function getAIStatus(): AIStatus {
  const config = getAIConfig();
  if (!config) {
    return {
      configured: false,
      provider: null,
      label: null,
      model: null,
      baseUrl: null,
      supported: AI_PROVIDERS.map((p) => p.id),
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
  };
}

export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; config?: AIConfig } = {}
): Promise<string> {
  const config = options.config || getAIConfig();
  if (!config) {
    throw new Error(
      'No AI provider configured. Set AI_PROVIDER plus any one of ' +
        AI_PROVIDERS.map((p) => `${p.keyEnv}`).join(', ') +
        ' in your environment.'
    );
  }

  const maxTokens = options.maxTokens || 2000;

  switch (config.provider) {
    case 'anthropic':
      return generateAnthropic(config, systemPrompt, userPrompt, maxTokens);
    case 'openai':
      return generateChatCompletions(
        'https://api.openai.com/v1',
        config,
        systemPrompt,
        userPrompt,
        maxTokens
      );
    case 'openrouter':
      return generateChatCompletions(
        'https://openrouter.ai/api/v1',
        config,
        systemPrompt,
        userPrompt,
        maxTokens
      );
    case 'gemini':
      return generateGemini(config, systemPrompt, userPrompt, maxTokens);
    case 'custom': {
      const baseUrl = config.baseUrl?.replace(/\/$/, '');
      if (!baseUrl) {
        throw new Error('AI_BASE_URL is required for the custom provider');
      }
      return generateChatCompletions(
        baseUrl,
        config,
        systemPrompt,
        userPrompt,
        maxTokens
      );
    }
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
    });
  } catch {
    throw new Error(`Could not reach AI provider at ${url}`);
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