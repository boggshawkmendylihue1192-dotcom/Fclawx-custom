import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';

type PlainRecord = Record<string, unknown>;

export type WebSearchProviderId =
  | 'auto'
  | 'brave'
  | 'duckduckgo'
  | 'exa'
  | 'firecrawl'
  | 'gemini'
  | 'grok'
  | 'kimi'
  | 'minimax'
  | 'ollama'
  | 'perplexity'
  | 'searxng'
  | 'tavily';

export type WebSearchProviderDefinition = {
  id: WebSearchProviderId;
  pluginId?: string;
  name: string;
  resultStyle: string;
  requiresApiKey: boolean;
  apiKeyEnv?: string;
  supportsBaseUrl?: boolean;
  supportsModel?: boolean;
  supportsRegion?: boolean;
  supportsLanguage?: boolean;
  supportsCategories?: boolean;
  supportsSafeSearch?: boolean;
};

export type WebSearchConfigSnapshot = {
  enabled: boolean;
  provider: WebSearchProviderId;
  maxResults: number;
  timeoutSeconds: number;
  cacheTtlMinutes: number;
  providers: WebSearchProviderDefinition[];
  providerConfigs: Record<string, Record<string, string>>;
};

export type WebSearchConfigUpdate = {
  enabled?: boolean;
  provider?: WebSearchProviderId;
  maxResults?: number;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
  providerConfig?: Record<string, string>;
};

export const WEB_SEARCH_PROVIDERS: WebSearchProviderDefinition[] = [
  {
    id: 'auto',
    name: '自动检测',
    resultStyle: '按 OpenClaw 顺序选择第一个已配置的搜索 provider',
    requiresApiKey: false,
  },
  {
    id: 'duckduckgo',
    pluginId: 'duckduckgo',
    name: 'DuckDuckGo',
    resultStyle: '结构化摘要，无需 API Key，实验性 HTML 集成',
    requiresApiKey: false,
    supportsRegion: true,
    supportsSafeSearch: true,
  },
  {
    id: 'tavily',
    pluginId: 'tavily',
    name: 'Tavily',
    resultStyle: '结构化搜索结果，适合 RAG 和资料检索',
    requiresApiKey: true,
    apiKeyEnv: 'TAVILY_API_KEY',
    supportsBaseUrl: true,
  },
  {
    id: 'gemini',
    pluginId: 'google',
    name: 'Gemini',
    resultStyle: 'Google Search grounding，生成式答案和引用',
    requiresApiKey: true,
    apiKeyEnv: 'GEMINI_API_KEY',
    supportsBaseUrl: true,
    supportsModel: true,
  },
  {
    id: 'grok',
    pluginId: 'xai',
    name: 'Grok',
    resultStyle: 'xAI web grounding，生成式答案和引用',
    requiresApiKey: true,
    apiKeyEnv: 'XAI_API_KEY',
    supportsBaseUrl: true,
    supportsModel: true,
  },
  {
    id: 'brave',
    pluginId: 'brave',
    name: 'Brave Search',
    resultStyle: '结构化结果，支持国家/语言/时间过滤',
    requiresApiKey: true,
    apiKeyEnv: 'BRAVE_API_KEY',
    supportsBaseUrl: true,
  },
  {
    id: 'searxng',
    pluginId: 'searxng',
    name: 'SearXNG',
    resultStyle: '自托管元搜索，无需商业 API Key',
    requiresApiKey: false,
    supportsBaseUrl: true,
    supportsCategories: true,
    supportsLanguage: true,
  },
  {
    id: 'exa',
    pluginId: 'exa',
    name: 'Exa',
    resultStyle: '神经搜索 + 内容抽取',
    requiresApiKey: true,
    apiKeyEnv: 'EXA_API_KEY',
    supportsBaseUrl: true,
  },
  {
    id: 'firecrawl',
    pluginId: 'firecrawl',
    name: 'Firecrawl',
    resultStyle: '结构化搜索，适合和抓取工具配合',
    requiresApiKey: true,
    apiKeyEnv: 'FIRECRAWL_API_KEY',
    supportsBaseUrl: true,
  },
  {
    id: 'kimi',
    pluginId: 'moonshot',
    name: 'Kimi',
    resultStyle: 'Moonshot 原生搜索 grounding',
    requiresApiKey: true,
    apiKeyEnv: 'KIMI_API_KEY / MOONSHOT_API_KEY',
    supportsBaseUrl: true,
    supportsModel: true,
  },
  {
    id: 'minimax',
    pluginId: 'minimax',
    name: 'MiniMax Search',
    resultStyle: 'MiniMax Token Plan 搜索 API',
    requiresApiKey: true,
    apiKeyEnv: 'MINIMAX_API_KEY',
    supportsRegion: true,
  },
  {
    id: 'ollama',
    pluginId: 'ollama',
    name: 'Ollama Web Search',
    resultStyle: '本地登录 Ollama 或托管 Ollama 搜索',
    requiresApiKey: false,
    apiKeyEnv: 'OLLAMA_API_KEY',
    supportsBaseUrl: true,
  },
  {
    id: 'perplexity',
    pluginId: 'perplexity',
    name: 'Perplexity',
    resultStyle: '搜索 API 或 Sonar/OpenRouter 兼容模式',
    requiresApiKey: true,
    apiKeyEnv: 'PERPLEXITY_API_KEY / OPENROUTER_API_KEY',
    supportsBaseUrl: true,
    supportsModel: true,
  },
];

function isPlainRecord(value: unknown): value is PlainRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProvider(value: unknown): WebSearchProviderId {
  const raw = typeof value === 'string' ? value.trim() : '';
  return WEB_SEARCH_PROVIDERS.some((provider) => provider.id === raw)
    ? raw as WebSearchProviderId
    : 'auto';
}

function numberOrDefault(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function ensureObject(parent: PlainRecord, key: string): PlainRecord {
  if (!isPlainRecord(parent[key])) {
    parent[key] = {};
  }
  return parent[key] as PlainRecord;
}

function getSearchConfig(config: PlainRecord): PlainRecord {
  const tools = ensureObject(config, 'tools');
  const web = ensureObject(tools, 'web');
  return ensureObject(web, 'search');
}

function getProviderWebSearchConfig(config: PlainRecord, pluginId: string): PlainRecord {
  const plugins = ensureObject(config, 'plugins');
  const entries = ensureObject(plugins, 'entries');
  const entry = ensureObject(entries, pluginId);
  entry.enabled = true;
  const entryConfig = ensureObject(entry, 'config');
  return ensureObject(entryConfig, 'webSearch');
}

function readProviderWebSearchConfig(config: PlainRecord, pluginId: string | undefined): Record<string, string> {
  if (!pluginId) return {};
  const plugins = isPlainRecord(config.plugins) ? config.plugins : {};
  const entries = isPlainRecord(plugins.entries) ? plugins.entries : {};
  const entry = isPlainRecord(entries[pluginId]) ? entries[pluginId] : {};
  const entryConfig = isPlainRecord(entry.config) ? entry.config : {};
  const webSearch = isPlainRecord(entryConfig.webSearch) ? entryConfig.webSearch : {};
  const result: Record<string, string> = {};
  for (const key of ['apiKey', 'baseUrl', 'model', 'region', 'safeSearch', 'categories', 'language']) {
    const value = webSearch[key];
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function cleanProviderConfig(input: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input || {})) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      result[key] = trimmed;
    }
  }
  return result;
}

export async function getWebSearchConfigSnapshot(): Promise<WebSearchConfigSnapshot> {
  const config = await readOpenClawConfig() as PlainRecord;
  const tools = isPlainRecord(config.tools) ? config.tools : {};
  const web = isPlainRecord(tools.web) ? tools.web : {};
  const search = isPlainRecord(web.search) ? web.search : {};

  return {
    enabled: search.enabled !== false,
    provider: normalizeProvider(search.provider),
    maxResults: numberOrDefault(search.maxResults, 5, 1, 20),
    timeoutSeconds: numberOrDefault(search.timeoutSeconds, 30, 5, 300),
    cacheTtlMinutes: numberOrDefault(search.cacheTtlMinutes, 15, 0, 1440),
    providers: WEB_SEARCH_PROVIDERS,
    providerConfigs: Object.fromEntries(
      WEB_SEARCH_PROVIDERS.map((provider) => [
        provider.id,
        readProviderWebSearchConfig(config, provider.pluginId),
      ]),
    ),
  };
}

export async function updateWebSearchConfig(update: WebSearchConfigUpdate): Promise<WebSearchConfigSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as PlainRecord;
    const search = getSearchConfig(config);

    if (typeof update.enabled === 'boolean') {
      search.enabled = update.enabled;
    }
    if (update.provider !== undefined) {
      const provider = normalizeProvider(update.provider);
      if (provider === 'auto') {
        delete search.provider;
      } else {
        search.provider = provider;
      }
    }
    if (update.maxResults !== undefined) {
      search.maxResults = numberOrDefault(update.maxResults, 5, 1, 20);
    }
    if (update.timeoutSeconds !== undefined) {
      search.timeoutSeconds = numberOrDefault(update.timeoutSeconds, 30, 5, 300);
    }
    if (update.cacheTtlMinutes !== undefined) {
      search.cacheTtlMinutes = numberOrDefault(update.cacheTtlMinutes, 15, 0, 1440);
    }

    const provider = WEB_SEARCH_PROVIDERS.find((entry) => entry.id === normalizeProvider(update.provider ?? search.provider));
    if (provider?.pluginId && update.providerConfig) {
      const pluginWebSearch = getProviderWebSearchConfig(config, provider.pluginId);
      const cleaned = cleanProviderConfig(update.providerConfig);
      for (const key of ['apiKey', 'baseUrl', 'model', 'region', 'safeSearch', 'categories', 'language']) {
        if (key in cleaned) {
          pluginWebSearch[key] = cleaned[key];
        } else if (key in update.providerConfig) {
          delete pluginWebSearch[key];
        }
      }
    }

    await writeOpenClawConfig(config);
    return getWebSearchConfigSnapshot();
  });
}
