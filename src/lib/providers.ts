/**
 * Provider Types & UI Metadata — single source of truth for the frontend.
 *
 * NOTE: Backend provider metadata is being refactored toward the new
 * account-based registry, but the renderer still keeps a local compatibility
 * layer so TypeScript project boundaries remain stable during the migration.
 */

export const PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'mistral',
  'xai',
  'together',
  'deepinfra',
  'fireworks',
  'cerebras',
  'chutes',
  'perplexity',
  'venice',
  'vercel-ai-gateway',
  'zai',
  'stepfun',
  'qianfan',
  'qwen',
  'nvidia',
  'huggingface',
  'litellm',
  'lmstudio',
  'vllm',
  'sglang',
  'cloudflare-ai-gateway',
  'ark',
  'moonshot',
  'moonshot-global',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
  'custom',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const BUILTIN_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'mistral',
  'xai',
  'together',
  'deepinfra',
  'fireworks',
  'cerebras',
  'chutes',
  'perplexity',
  'venice',
  'vercel-ai-gateway',
  'zai',
  'stepfun',
  'qianfan',
  'qwen',
  'nvidia',
  'huggingface',
  'litellm',
  'lmstudio',
  'vllm',
  'sglang',
  'cloudflare-ai-gateway',
  'ark',
  'moonshot',
  'moonshot-global',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
] as const;

export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama-local';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWithKeyInfo extends ProviderConfig {
  hasKey: boolean;
  keyMasked: string | null;
}

export interface ProviderTypeInfo {
  id: ProviderType;
  name: string;
  icon: string;
  placeholder: string;
  model?: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string;
  defaultModelId?: string;
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  /** If true, this provider is not shown in the "Add Provider" dialog. */
  hidden?: boolean;
  /** If true, hide OAuth sign-in controls in the add-provider UI (logic remains enabled). */
  hideOAuthUi?: boolean;
}

export type ProviderAuthMode =
  | 'api_key'
  | 'oauth_device'
  | 'oauth_browser'
  | 'local';

export type ProviderVendorCategory =
  | 'official'
  | 'compatible'
  | 'local'
  | 'custom';

export interface ProviderVendorInfo extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
}

export interface ProviderAccount {
  id: string;
  vendorId: ProviderType;
  label: string;
  authMode: ProviderAuthMode;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackAccountIds?: string[];
  enabled: boolean;
  isDefault: boolean;
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    customModels?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

import { providerIcons } from '@/assets/providers';

/** All supported provider types with UI metadata */
export const PROVIDER_TYPE_INFO: ProviderTypeInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🤖',
    placeholder: 'sk-ant-api03-...',
    model: 'Claude',
    requiresApiKey: true,
    showModelId: true,
    defaultModelId: 'claude-opus-4-6',
    modelIdPlaceholder: 'claude-opus-4-6',
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '💚',
    placeholder: 'sk-proj-...',
    model: 'GPT',
    requiresApiKey: true,
    isOAuth: true,
    supportsApiKey: true,
    defaultModelId: 'gpt-5.5',
    showModelId: true,
    modelIdPlaceholder: 'gpt-5.5',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google',
    name: 'Google',
    icon: '🔷',
    placeholder: 'AIza...',
    model: 'Gemini',
    requiresApiKey: true,
    defaultModelId: 'gemini-3.1-pro-preview',
    showModelId: true,
    modelIdPlaceholder: 'gemini-3.1-pro-preview',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
  },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐', placeholder: 'sk-or-v1-...', model: 'Multi-Model', requiresApiKey: true, showModelId: true, modelIdPlaceholder: 'openai/gpt-5.5', defaultModelId: 'openai/gpt-5.5', docsUrl: 'https://openrouter.ai/models' },
  { id: 'groq', name: 'Groq', icon: 'G', placeholder: 'gsk_...', model: 'LPU Inference', requiresApiKey: true, defaultBaseUrl: 'https://api.groq.com/openai/v1', showModelId: true, modelIdPlaceholder: 'llama-3.3-70b-versatile', defaultModelId: 'llama-3.3-70b-versatile', apiKeyUrl: 'https://console.groq.com/keys', docsUrl: 'https://console.groq.com/docs' },
  { id: 'mistral', name: 'Mistral', icon: 'M', placeholder: 'API key...', model: 'Mistral', requiresApiKey: true, defaultBaseUrl: 'https://api.mistral.ai/v1', showModelId: true, modelIdPlaceholder: 'mistral-large-latest', defaultModelId: 'mistral-large-latest', apiKeyUrl: 'https://console.mistral.ai/api-keys/', docsUrl: 'https://docs.mistral.ai/' },
  { id: 'xai', name: 'xAI', icon: 'X', placeholder: 'xai-...', model: 'Grok', requiresApiKey: true, defaultBaseUrl: 'https://api.x.ai/v1', showModelId: true, modelIdPlaceholder: 'grok-4', defaultModelId: 'grok-4', apiKeyUrl: 'https://console.x.ai/', docsUrl: 'https://docs.x.ai/' },
  { id: 'together', name: 'Together AI', icon: 'T', placeholder: 'API key...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://api.together.xyz/v1', showModelId: true, modelIdPlaceholder: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', defaultModelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', apiKeyUrl: 'https://api.together.xyz/settings/api-keys', docsUrl: 'https://docs.together.ai/' },
  { id: 'deepinfra', name: 'DeepInfra', icon: 'D', placeholder: 'API key...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://api.deepinfra.com/v1/openai', showModelId: true, modelIdPlaceholder: 'meta-llama/Meta-Llama-3.1-70B-Instruct', defaultModelId: 'meta-llama/Meta-Llama-3.1-70B-Instruct', apiKeyUrl: 'https://deepinfra.com/dash/api_keys', docsUrl: 'https://deepinfra.com/docs' },
  { id: 'fireworks', name: 'Fireworks', icon: 'F', placeholder: 'fw_...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', showModelId: true, modelIdPlaceholder: 'accounts/fireworks/models/llama-v3p1-70b-instruct', defaultModelId: 'accounts/fireworks/models/llama-v3p1-70b-instruct', apiKeyUrl: 'https://fireworks.ai/account/api-keys', docsUrl: 'https://docs.fireworks.ai/' },
  { id: 'cerebras', name: 'Cerebras', icon: 'C', placeholder: 'API key...', model: 'Cerebras', requiresApiKey: true, defaultBaseUrl: 'https://api.cerebras.ai/v1', showModelId: true, modelIdPlaceholder: 'llama3.1-70b', defaultModelId: 'llama3.1-70b', apiKeyUrl: 'https://cloud.cerebras.ai/platform/', docsUrl: 'https://inference-docs.cerebras.ai/' },
  { id: 'chutes', name: 'Chutes', icon: 'C', placeholder: 'cpk_...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://llm.chutes.ai/v1', showModelId: true, modelIdPlaceholder: 'deepseek-ai/DeepSeek-V3-0324', defaultModelId: 'deepseek-ai/DeepSeek-V3-0324', docsUrl: 'https://docs.chutes.ai/' },
  { id: 'perplexity', name: 'Perplexity', icon: 'P', placeholder: 'pplx-...', model: 'Sonar', requiresApiKey: true, defaultBaseUrl: 'https://api.perplexity.ai', showModelId: true, modelIdPlaceholder: 'sonar-pro', defaultModelId: 'sonar-pro', apiKeyUrl: 'https://www.perplexity.ai/settings/api', docsUrl: 'https://docs.perplexity.ai/' },
  { id: 'venice', name: 'Venice AI', icon: 'V', placeholder: 'API key...', model: 'Privacy Models', requiresApiKey: true, defaultBaseUrl: 'https://api.venice.ai/api/v1', showModelId: true, modelIdPlaceholder: 'llama-3.3-70b', defaultModelId: 'llama-3.3-70b', apiKeyUrl: 'https://venice.ai/settings/api', docsUrl: 'https://docs.venice.ai/' },
  { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', icon: 'V', placeholder: 'vck_...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://ai-gateway.vercel.sh/v1', showModelId: true, modelIdPlaceholder: 'openai/gpt-5', defaultModelId: 'openai/gpt-5', docsUrl: 'https://vercel.com/docs/ai-gateway' },
  { id: 'zai', name: 'Z.AI', icon: 'Z', placeholder: 'API key...', model: 'GLM', requiresApiKey: true, defaultBaseUrl: 'https://api.z.ai/api/paas/v4', showModelId: true, modelIdPlaceholder: 'glm-4.6', defaultModelId: 'glm-4.6', docsUrl: 'https://docs.z.ai/' },
  { id: 'stepfun', name: 'StepFun', icon: 'S', placeholder: 'API key...', model: 'Step', requiresApiKey: true, defaultBaseUrl: 'https://api.stepfun.com/v1', showModelId: true, modelIdPlaceholder: 'step-2-mini', defaultModelId: 'step-2-mini', docsUrl: 'https://platform.stepfun.com/docs' },
  { id: 'qianfan', name: 'Qianfan', icon: 'Q', placeholder: 'API key...', model: 'ERNIE', requiresApiKey: true, defaultBaseUrl: 'https://qianfan.baidubce.com/v2', showModelId: true, modelIdPlaceholder: 'ernie-4.5-turbo-128k', defaultModelId: 'ernie-4.5-turbo-128k', docsUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/' },
  { id: 'qwen', name: 'Qwen Cloud', icon: 'Q', placeholder: 'sk-...', model: 'Qwen', requiresApiKey: true, defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', showModelId: true, modelIdPlaceholder: 'qwen-max-latest', defaultModelId: 'qwen-max-latest', apiKeyUrl: 'https://bailian.console.aliyun.com/', docsUrl: 'https://help.aliyun.com/zh/model-studio/' },
  { id: 'nvidia', name: 'NVIDIA', icon: 'N', placeholder: 'nvapi-...', model: 'NIM', requiresApiKey: true, defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', showModelId: true, modelIdPlaceholder: 'meta/llama-3.1-70b-instruct', defaultModelId: 'meta/llama-3.1-70b-instruct', docsUrl: 'https://docs.api.nvidia.com/' },
  { id: 'huggingface', name: 'Hugging Face', icon: 'H', placeholder: 'hf_...', model: 'Inference', requiresApiKey: true, defaultBaseUrl: 'https://router.huggingface.co/v1', showModelId: true, modelIdPlaceholder: 'meta-llama/Llama-3.1-70B-Instruct', defaultModelId: 'meta-llama/Llama-3.1-70B-Instruct', apiKeyUrl: 'https://huggingface.co/settings/tokens', docsUrl: 'https://huggingface.co/docs/api-inference/' },
  { id: 'litellm', name: 'LiteLLM', icon: 'L', placeholder: 'API key...', model: 'Gateway', requiresApiKey: true, defaultBaseUrl: 'http://localhost:4000/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'openai/gpt-5', defaultModelId: 'openai/gpt-5', docsUrl: 'https://docs.litellm.ai/' },
  { id: 'lmstudio', name: 'LM Studio', icon: 'L', placeholder: 'Not required', model: 'Local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:1234/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'local-model', defaultModelId: 'local-model', docsUrl: 'https://lmstudio.ai/docs' },
  { id: 'vllm', name: 'vLLM', icon: 'V', placeholder: 'Not required', model: 'Local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:8000/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'served-model-name', defaultModelId: 'served-model-name', docsUrl: 'https://docs.vllm.ai/' },
  { id: 'sglang', name: 'SGLang', icon: 'S', placeholder: 'Not required', model: 'Local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:30000/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'served-model-name', defaultModelId: 'served-model-name', docsUrl: 'https://docs.sglang.ai/' },
  { id: 'cloudflare-ai-gateway', name: 'Cloudflare AI Gateway', icon: 'C', placeholder: 'API key...', model: 'Gateway', requiresApiKey: true, defaultBaseUrl: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'openai/gpt-5', defaultModelId: 'openai/gpt-5', docsUrl: 'https://developers.cloudflare.com/ai-gateway/' },
  { id: 'minimax-portal-cn', name: 'MiniMax (CN)', icon: '☁️', placeholder: 'sk-...', model: 'MiniMax', requiresApiKey: false, isOAuth: true, supportsApiKey: true, defaultModelId: 'MiniMax-M2.7', showModelId: true, modelIdPlaceholder: 'MiniMax-M2.7', apiKeyUrl: 'https://platform.minimaxi.com/' },
  { id: 'moonshot', name: 'Moonshot (CN)', icon: '🌙', placeholder: 'sk-...', model: 'Kimi', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.cn/v1', showModelId: true, defaultModelId: 'kimi-k2.6', modelIdPlaceholder: 'kimi-k2.6', docsUrl: 'https://platform.moonshot.cn/' },
  { id: 'moonshot-global', name: 'Moonshot (Global)', icon: '🌙', placeholder: 'sk-...', model: 'Kimi', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.ai/v1', showModelId: true, defaultModelId: 'kimi-k2.6', modelIdPlaceholder: 'kimi-k2.6', docsUrl: 'https://platform.moonshot.ai/' },
  { id: 'siliconflow', name: 'SiliconFlow (CN)', icon: '🌊', placeholder: 'sk-...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://api.siliconflow.cn/v1', showModelId: true, modelIdPlaceholder: 'deepseek-ai/DeepSeek-V3', defaultModelId: 'deepseek-ai/DeepSeek-V3', docsUrl: 'https://docs.siliconflow.cn/cn/userguide/introduction' },
  { id: 'deepseek', name: 'DeepSeek', icon: '🐋', placeholder: 'sk-...', model: 'DeepSeek', requiresApiKey: true, defaultBaseUrl: 'https://api.deepseek.com/v1', showModelId: true, modelIdPlaceholder: 'deepseek-v4-pro', defaultModelId: 'deepseek-v4-pro', apiKeyUrl: 'https://platform.deepseek.com/api_keys', docsUrl: 'https://api-docs.deepseek.com/', docsUrlZh: 'https://api-docs.deepseek.com/zh-cn/' },
  { id: 'minimax-portal', name: 'MiniMax (Global)', icon: '☁️', placeholder: 'sk-...', model: 'MiniMax', requiresApiKey: false, isOAuth: true, supportsApiKey: true, defaultModelId: 'MiniMax-M2.7', showModelId: true, modelIdPlaceholder: 'MiniMax-M2.7', apiKeyUrl: 'https://platform.minimax.io' },
  { id: 'modelstudio', name: 'Model Studio', icon: '☁️', placeholder: 'sk-...', model: 'Qwen', requiresApiKey: true, defaultBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1', showBaseUrl: true, defaultModelId: 'qwen3.6-plus', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'qwen3.6-plus', apiKeyUrl: 'https://bailian.console.aliyun.com/', hidden: true },
  { id: 'ark', name: 'ByteDance Ark', icon: 'A', placeholder: 'your-ark-api-key', model: 'Doubao', requiresApiKey: true, defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'ep-20260228000000-xxxxx', docsUrl: 'https://www.volcengine.com/', codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', codePlanPresetModelId: 'ark-code-latest', codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh' },
  { id: 'ollama', name: 'Ollama', icon: '🦙', placeholder: 'Not required', requiresApiKey: false, defaultBaseUrl: 'http://localhost:11434/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'qwen3:latest' },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    placeholder: 'API key...',
    requiresApiKey: true,
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'your-provider/model-id',
    docsUrl: 'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#Ee1ldfvKJoVGvfxc32mcILwenth',
    docsUrlZh: 'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#IWQCdfe5fobGU3xf3UGcgbLynGh',
  },
];

/** Get the SVG logo URL for a provider type, falls back to undefined */
export function getProviderIconUrl(type: ProviderType | string): string | undefined {
  return providerIcons[type];
}

/** Whether a provider's logo needs CSS invert in dark mode (all logos are monochrome) */
export function shouldInvertInDark(_type: ProviderType | string): boolean {
  return true;
}

/** Provider list shown in the Setup wizard */
export const SETUP_PROVIDERS = PROVIDER_TYPE_INFO;

/** Get type info by provider type id */
export function getProviderTypeInfo(type: ProviderType): ProviderTypeInfo | undefined {
  return PROVIDER_TYPE_INFO.find((t) => t.id === type);
}

export function getProviderDocsUrl(
  provider: Pick<ProviderTypeInfo, 'docsUrl' | 'docsUrlZh'> | undefined,
  language: string
): string | undefined {
  if (!provider?.docsUrl) {
    return undefined;
  }

  if (language.startsWith('zh') && provider.docsUrlZh) {
    return provider.docsUrlZh;
  }

  return provider.docsUrl;
}

export function shouldShowProviderModelId(
  provider: Pick<ProviderTypeInfo, 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  devModeUnlocked: boolean
): boolean {
  if (!provider?.showModelId) return false;
  if (provider.showModelIdInDevModeOnly && !devModeUnlocked) return false;
  return true;
}

export function resolveProviderModelForSave(
  provider: Pick<ProviderTypeInfo, 'defaultModelId' | 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  modelId: string,
  devModeUnlocked: boolean
): string | undefined {
  if (!shouldShowProviderModelId(provider, devModeUnlocked)) {
    return undefined;
  }

  const trimmedModelId = modelId.trim();
  return trimmedModelId || provider?.defaultModelId || undefined;
}

export function normalizeProviderApiKeyInput(apiKey: string): string {
  return apiKey.trim();
}

/** Normalize provider API key before saving; Ollama uses a local placeholder when blank. */
export function resolveProviderApiKeyForSave(type: ProviderType | string, apiKey: string): string | undefined {
  const trimmed = normalizeProviderApiKeyInput(apiKey);
  if (type === 'ollama') {
    return trimmed || OLLAMA_PLACEHOLDER_API_KEY;
  }
  return trimmed || undefined;
}
