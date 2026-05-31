import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Database,
  FileSearch,
  KeyRound,
  Loader2,
  MessageSquareText,
  Network,
  RotateCcw,
  Save,
  Search,
  Server,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';

type WebSearchProviderId =
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

type SearchToolId = 'web_search' | 'x_search' | 'web_fetch';

type WebSearchProviderDefinition = {
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

type WebSearchConfigSnapshot = {
  success?: boolean;
  enabled: boolean;
  provider: WebSearchProviderId;
  maxResults: number;
  timeoutSeconds: number;
  cacheTtlMinutes: number;
  providers: WebSearchProviderDefinition[];
  providerConfigs: Record<string, Record<string, string>>;
};

type ProviderConfigDraft = {
  apiKey: string;
  baseUrl: string;
  model: string;
  region: string;
  safeSearch: string;
  categories: string;
  language: string;
};

const EMPTY_PROVIDER_CONFIG: ProviderConfigDraft = {
  apiKey: '',
  baseUrl: '',
  model: '',
  region: '',
  safeSearch: '',
  categories: '',
  language: '',
};

const SEARCH_TOOLS: Array<{
  id: SearchToolId;
  name: string;
  summary: string;
  icon: typeof Search;
}> = [
  {
    id: 'web_search',
    name: 'web_search',
    summary: '通用网页搜索，支持 DuckDuckGo、Tavily、Gemini、Grok、Brave、SearXNG 等 provider。',
    icon: Search,
  },
  {
    id: 'x_search',
    name: 'x_search',
    summary: '搜索 X / Twitter 内容，使用 xAI 相关认证与 OpenClaw 的 xAI 插件配置。',
    icon: MessageSquareText,
  },
  {
    id: 'web_fetch',
    name: 'web_fetch',
    summary: '读取指定 URL 的网页正文，适合打开已知链接，不等同于关键词搜索。',
    icon: FileSearch,
  },
];

const DEFAULT_SEARCH_MODEL: Partial<Record<WebSearchProviderId, string>> = {
  gemini: 'gemini-2.5-flash',
  grok: 'grok-4-1-fast',
  kimi: 'kimi-k2.6',
  perplexity: 'sonar',
  tavily: 'Tavily Search API',
  brave: 'Brave Search API',
  exa: 'Exa Search API',
  firecrawl: 'Firecrawl Search API',
  minimax: 'MiniMax Search API',
  ollama: 'Ollama Web Search',
  duckduckgo: 'DuckDuckGo HTML',
  searxng: 'SearXNG instance',
};

function toProviderDraft(config: Record<string, string> | undefined): ProviderConfigDraft {
  return {
    ...EMPTY_PROVIDER_CONFIG,
    ...(config || {}),
  };
}

function toProviderConfigPayload(draft: ProviderConfigDraft): Record<string, string> {
  return {
    apiKey: draft.apiKey,
    baseUrl: draft.baseUrl,
    model: draft.model,
    region: draft.region,
    safeSearch: draft.safeSearch,
    categories: draft.categories,
    language: draft.language,
  };
}

function providerBadge(provider: WebSearchProviderDefinition): string {
  if (provider.id === 'auto') return '自动';
  if (!provider.requiresApiKey) return '免 Key';
  return provider.apiKeyEnv || 'API Key';
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '已填写';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function SearchFlowPreview({
  enabled,
  tool,
  provider,
  draft,
}: {
  enabled: boolean;
  tool: SearchToolId;
  provider: WebSearchProviderDefinition | null;
  draft: ProviderConfigDraft;
}) {
  if (!provider) return null;
  const selectedTool = SEARCH_TOOLS.find((entry) => entry.id === tool) || SEARCH_TOOLS[0];

  const modelLabel = provider.id === 'auto'
    ? '自动选择可用搜索后端'
    : draft.model.trim() || DEFAULT_SEARCH_MODEL[provider.id] || provider.name;
  const authLabel = provider.id === 'auto'
    ? '按自动检测结果决定'
    : provider.requiresApiKey
      ? (draft.apiKey.trim() ? `页面密钥 ${maskSecret(draft.apiKey)}` : provider.apiKeyEnv || '需要 API Key')
      : '不需要 API Key';
  const endpointLabel = draft.baseUrl.trim()
    || (provider.id === 'searxng' ? '请配置 SearXNG Base URL' : '默认端点');
  const pluginLabel = provider.pluginId || (provider.id === 'auto' ? 'auto' : provider.id);

  const steps = [
    { icon: selectedTool.icon, title: '搜索工具', value: `${selectedTool.name} · ${enabled ? '已启用' : '已关闭'}` },
    { icon: Network, title: 'Provider', value: provider.name },
    { icon: BrainCircuit, title: '搜索模型/后端', value: modelLabel },
    { icon: KeyRound, title: '认证', value: authLabel },
    { icon: Database, title: '配置写入', value: `plugins.entries.${pluginLabel}.config.webSearch` },
  ];

  return (
    <div className="rounded-lg border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-4 flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground">搜索模型可视化</h3>
        <p className="text-xs text-muted-foreground">
          这里展示的是 web_search 的搜索后端，不会改变聊天模型。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="relative rounded-lg border border-black/10 bg-background p-3 dark:border-white/10">
              {index > 0 && (
                <div className="pointer-events-none absolute -left-3 top-1/2 hidden h-px w-3 bg-black/10 dark:bg-white/10 md:block" />
              )}
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon className="h-4 w-4" />
                {step.title}
              </div>
              <div className="min-h-10 break-words text-sm font-semibold text-foreground">
                {step.value}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-black/5 px-3 py-2 text-xs text-muted-foreground dark:bg-white/10">
          端点：<span className="text-foreground">{endpointLabel}</span>
        </div>
        <div className="rounded-lg bg-black/5 px-3 py-2 text-xs text-muted-foreground dark:bg-white/10">
          结果数：<span className="text-foreground">由最大结果数控制</span>
        </div>
        <div className="rounded-lg bg-black/5 px-3 py-2 text-xs text-muted-foreground dark:bg-white/10">
          缓存：<span className="text-foreground">按查询缓存</span>
        </div>
      </div>
    </div>
  );
}

export function WebSearchSettings() {
  const [snapshot, setSnapshot] = useState<WebSearchConfigSnapshot | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState<WebSearchProviderId>('auto');
  const [maxResults, setMaxResults] = useState('5');
  const [timeoutSeconds, setTimeoutSeconds] = useState('30');
  const [cacheTtlMinutes, setCacheTtlMinutes] = useState('15');
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderConfigDraft>>({});
  const [searchTool, setSearchTool] = useState<SearchToolId>('web_search');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedProvider = useMemo(
    () => snapshot?.providers.find((entry) => entry.id === provider) ?? null,
    [provider, snapshot?.providers],
  );
  const selectedDraft = providerDrafts[provider] || EMPTY_PROVIDER_CONFIG;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await hostApiFetch<WebSearchConfigSnapshot>('/api/web-search');
      setSnapshot(next);
      setEnabled(next.enabled);
      setProvider(next.provider);
      setMaxResults(String(next.maxResults));
      setTimeoutSeconds(String(next.timeoutSeconds));
      setCacheTtlMinutes(String(next.cacheTtlMinutes));
      setProviderDrafts(Object.fromEntries(
        next.providers.map((entry) => [
          entry.id,
          toProviderDraft(next.providerConfigs[entry.id]),
        ]),
      ));
    } catch (error) {
      toast.error(`搜索工具配置加载失败：${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateSelectedDraft = (patch: Partial<ProviderConfigDraft>) => {
    setProviderDrafts((current) => ({
      ...current,
      [provider]: {
        ...(current[provider] || EMPTY_PROVIDER_CONFIG),
        ...patch,
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = await hostApiFetch<WebSearchConfigSnapshot>('/api/web-search', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          provider,
          maxResults: Number(maxResults),
          timeoutSeconds: Number(timeoutSeconds),
          cacheTtlMinutes: Number(cacheTtlMinutes),
          providerConfig: toProviderConfigPayload(selectedDraft),
        }),
      });
      setSnapshot(next);
      setEnabled(next.enabled);
      setProvider(next.provider);
      setMaxResults(String(next.maxResults));
      setTimeoutSeconds(String(next.timeoutSeconds));
      setCacheTtlMinutes(String(next.cacheTtlMinutes));
      setProviderDrafts(Object.fromEntries(
        next.providers.map((entry) => [
          entry.id,
          toProviderDraft(next.providerConfigs[entry.id]),
        ]),
      ));
      toast.success('搜索工具设置已保存，网关会自动重新加载');
    } catch (error) {
      toast.error(`搜索工具设置保存失败：${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="web-search-settings" className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-3xl font-serif text-foreground font-normal tracking-tight">
            搜索工具
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            配置 web_search 使用的搜索 provider。它独立于聊天模型，避免模型选择和搜索后端互相影响。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-lg border-black/10 bg-transparent dark:border-white/10"
            onClick={() => void load()}
            disabled={loading || saving}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
          <Button
            size="sm"
            className="h-9 rounded-lg"
            onClick={() => void handleSave()}
            disabled={loading || saving}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div>
          <Label className="text-sm font-medium text-foreground">启用 web_search</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            关闭后，OpenClaw 的托管搜索和原生 Codex/OpenAI 搜索都会禁用。
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-medium text-foreground">搜索工具选择</Label>
        <div className="grid gap-3 md:grid-cols-3">
          {SEARCH_TOOLS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSearchTool(entry.id)}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  searchTool === entry.id
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-black/10 bg-transparent hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.05]',
                )}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {entry.name}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {entry.summary}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <SearchFlowPreview enabled={enabled} tool={searchTool} provider={selectedProvider} draft={selectedDraft} />

      {searchTool !== 'web_search' && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          当前页面完整保存的是 web_search provider 配置。{searchTool === 'x_search'
            ? 'x_search 使用 xAI 插件与 X 搜索配置，后续可以继续扩展为独立 x_search 设置。'
            : 'web_fetch 用于读取指定 URL，provider 选择与 web_search 分开，后续可以继续扩展为独立 web_fetch 设置。'}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(snapshot?.providers || []).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setProvider(entry.id)}
            className={cn(
              'rounded-lg border p-4 text-left transition-colors',
              provider === entry.id
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-black/10 bg-transparent hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.05]',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {entry.id === 'searxng' ? (
                  <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : entry.requiresApiKey ? (
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm font-semibold">{entry.name}</span>
              </div>
              <span className="rounded-md bg-black/5 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-white/10">
                {providerBadge(entry)}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {entry.resultStyle}
            </p>
          </button>
        ))}
      </div>

      <div className="grid gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10 md:grid-cols-3">
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4" />
            最大结果数
          </Label>
          <Input value={maxResults} onChange={(event) => setMaxResults(event.target.value)} inputMode="numeric" />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">超时秒数</Label>
          <Input value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} inputMode="numeric" />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">缓存分钟</Label>
          <Input value={cacheTtlMinutes} onChange={(event) => setCacheTtlMinutes(event.target.value)} inputMode="numeric" />
        </div>
      </div>

      {selectedProvider && selectedProvider.id !== 'auto' && (
        <div className="space-y-4 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <div>
            <h3 className="text-base font-semibold text-foreground">{selectedProvider.name} 配置</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedProvider.apiKeyEnv
                ? `可填写 API Key，也可以使用环境变量 ${selectedProvider.apiKeyEnv}。`
                : '该 provider 通常不需要 API Key。'}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {selectedProvider.requiresApiKey && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">API Key</Label>
                <Input
                  type="password"
                  value={selectedDraft.apiKey}
                  onChange={(event) => updateSelectedDraft({ apiKey: event.target.value })}
                  placeholder={selectedProvider.id === 'grok' ? 'xai-...' : '可留空使用环境变量'}
                />
              </div>
            )}
            {selectedProvider.supportsBaseUrl && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Base URL</Label>
                <Input
                  value={selectedDraft.baseUrl}
                  onChange={(event) => updateSelectedDraft({ baseUrl: event.target.value })}
                  placeholder={selectedProvider.id === 'searxng' ? 'http://localhost:8888' : '可选'}
                />
              </div>
            )}
            {selectedProvider.supportsModel && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">搜索模型</Label>
                <Input
                  value={selectedDraft.model}
                  onChange={(event) => updateSelectedDraft({ model: event.target.value })}
                  placeholder={selectedProvider.id === 'gemini' ? 'gemini-2.5-flash' : DEFAULT_SEARCH_MODEL[selectedProvider.id] || '可选'}
                />
              </div>
            )}
            {selectedProvider.supportsRegion && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">地区/区域</Label>
                <Input
                  value={selectedDraft.region}
                  onChange={(event) => updateSelectedDraft({ region: event.target.value })}
                  placeholder={selectedProvider.id === 'duckduckgo' ? 'us-en' : 'global'}
                />
              </div>
            )}
            {selectedProvider.supportsSafeSearch && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">SafeSearch</Label>
                <Input
                  value={selectedDraft.safeSearch}
                  onChange={(event) => updateSelectedDraft({ safeSearch: event.target.value })}
                  placeholder="strict / moderate / off"
                />
              </div>
            )}
            {selectedProvider.supportsCategories && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">分类</Label>
                <Input
                  value={selectedDraft.categories}
                  onChange={(event) => updateSelectedDraft({ categories: event.target.value })}
                  placeholder="general,news"
                />
              </div>
            )}
            {selectedProvider.supportsLanguage && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">语言</Label>
                <Input
                  value={selectedDraft.language}
                  onChange={(event) => updateSelectedDraft({ language: event.target.value })}
                  placeholder="zh-CN / en"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default WebSearchSettings;
