import type { ProviderAccount, ProviderConfig, ProviderType } from '../../shared/providers/types';
import { getProviderDefinition } from '../../shared/providers/registry';
import { getClawXProviderStore } from './store-instance';
import { getProviderSecret } from '../secrets/secret-store';


function inferAuthMode(type: ProviderType): ProviderAccount['authMode'] {
  if (type === 'ollama') {
    return 'local';
  }

  const definition = getProviderDefinition(type);
  if (definition?.defaultAuthMode) {
    return definition.defaultAuthMode;
  }

  return 'api_key';
}

export function providerConfigToAccount(
  config: ProviderConfig,
  options?: { isDefault?: boolean },
): ProviderAccount {
  return {
    id: config.id,
    vendorId: config.type,
    label: config.name,
    authMode: inferAuthMode(config.type),
    baseUrl: config.baseUrl,
    apiProtocol: config.apiProtocol || (config.type === 'custom' || config.type === 'ollama'
      ? 'openai-completions'
      : getProviderDefinition(config.type)?.providerConfig?.api),
    headers: config.headers,
    model: config.model,
    fallbackModels: config.fallbackModels,
    fallbackAccountIds: config.fallbackProviderIds,
    enabled: config.enabled,
    isDefault: options?.isDefault ?? false,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export function providerAccountToConfig(account: ProviderAccount): ProviderConfig {
  return {
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    headers: account.headers,
    model: account.model,
    fallbackModels: account.fallbackModels,
    fallbackProviderIds: account.fallbackAccountIds,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function listProviderAccounts(): Promise<ProviderAccount[]> {
  const store = await getClawXProviderStore();
  const accounts = store.get('providerAccounts') as Record<string, ProviderAccount> | undefined;
  const nextAccounts = { ...(accounts ?? {}) };
  let modified = false;
  const result: ProviderAccount[] = [];

  for (const account of Object.values(nextAccounts)) {
    const healed = await healAccountAuthModeFromSecret(account);
    result.push(healed);
    if (healed !== account) {
      nextAccounts[account.id] = healed;
      modified = true;
    }
  }

  if (modified) {
    store.set('providerAccounts', nextAccounts);
  }

  return result;
}

export async function getProviderAccount(accountId: string): Promise<ProviderAccount | null> {
  const store = await getClawXProviderStore();
  const accounts = store.get('providerAccounts') as Record<string, ProviderAccount> | undefined;
  const account = accounts?.[accountId] ?? null;
  if (!account) return null;

  const healed = await healAccountAuthModeFromSecret(account);
  if (healed !== account) {
    const nextAccounts = { ...(accounts ?? {}), [accountId]: healed };
    store.set('providerAccounts', nextAccounts);
  }
  return healed;
}

export async function saveProviderAccount(account: ProviderAccount): Promise<void> {
  const store = await getClawXProviderStore();
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  accounts[account.id] = await healAccountAuthModeFromSecret(account);
  store.set('providerAccounts', accounts);
}

async function healAccountAuthModeFromSecret(account: ProviderAccount): Promise<ProviderAccount> {
  const secret = await getProviderSecret(account.id);
  if (!secret) {
    return account;
  }

  let nextAuthMode: ProviderAccount['authMode'] | undefined;
  if (secret.type === 'oauth') {
    nextAuthMode = account.vendorId === 'minimax-portal' || account.vendorId === 'minimax-portal-cn'
      ? 'oauth_device'
      : 'oauth_browser';
  } else if (secret.type === 'local') {
    nextAuthMode = 'local';
  } else if (secret.type === 'api_key') {
    nextAuthMode = 'api_key';
  }

  if (!nextAuthMode || account.authMode === nextAuthMode) {
    return account;
  }

  return {
    ...account,
    authMode: nextAuthMode,
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteProviderAccount(accountId: string): Promise<void> {
  const store = await getClawXProviderStore();
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  delete accounts[accountId];
  store.set('providerAccounts', accounts);

  if (store.get('defaultProviderAccountId') === accountId) {
    store.delete('defaultProviderAccountId');
  }
}

export async function setDefaultProviderAccount(accountId: string): Promise<void> {
  const store = await getClawXProviderStore();
  store.set('defaultProviderAccountId', accountId);

  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  for (const account of Object.values(accounts)) {
    account.isDefault = account.id === accountId;
  }
  store.set('providerAccounts', accounts);
}

export async function getDefaultProviderAccountId(): Promise<string | undefined> {
  const store = await getClawXProviderStore();
  return store.get('defaultProviderAccountId') as string | undefined;
}
