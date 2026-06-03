/**
 * Dynamic imports for openclaw plugin-sdk subpath exports.
 *
 * openclaw is NOT in the asar's node_modules — it lives at resources/openclaw/
 * (extraResources).  Static `import ... from 'openclaw/plugin-sdk/...'` would
 * produce a runtime require() that fails inside the asar.
 *
 * Instead, we create a require context from the openclaw directory itself.
 * Node.js package self-referencing allows a package to require its own exports
 * by name, so `openclawRequire('openclaw/plugin-sdk/discord')` resolves via the
 * exports map in openclaw's package.json.
 *
 * In dev mode (pnpm), the resolved path is in the pnpm virtual store where
 * self-referencing also works.  The projectRequire fallback covers edge cases.
 *
 * openclaw 2026.4.5 removed the per-channel plugin-sdk subpath exports
 * (discord, telegram-surface, slack, whatsapp-shared).  The functions now live
 * in the extension bundles (dist/extensions/<channel>/api.js) which pull in
 * heavy optional dependencies (grammy, @buape/carbon, @slack/web-api …).
 *
 * Since ClawX only uses the lightweight normalize / directory helpers, we load
 * these from the extension API files directly.  If the optional dependency is
 * missing (common in dev without full install), we fall back to no-op stubs so
 * the app can still start — the target picker will simply be empty for that
 * channel.
 */
import { createRequire } from 'module';
import { join } from 'node:path';
import { getOpenClawDir, getOpenClawResolvedDir } from './paths';

interface RuntimeSdkRequireContext {
  key: string;
  openclawSdkRequire: NodeJS.Require;
  projectSdkRequire: NodeJS.Require;
}

let runtimeRequireContext: RuntimeSdkRequireContext | null = null;

function getRuntimeSdkRequireContext(): RuntimeSdkRequireContext {
  const openclawResolvedPath = getOpenClawResolvedDir();
  const openclawPath = getOpenClawDir();
  const key = `${openclawResolvedPath}|${openclawPath}`;
  if (runtimeRequireContext?.key === key) {
    return runtimeRequireContext;
  }

  runtimeRequireContext = {
    key,
    openclawSdkRequire: createRequire(join(openclawResolvedPath, 'package.json')),
    projectSdkRequire: createRequire(join(openclawPath, 'package.json')),
  };
  return runtimeRequireContext;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireOpenClawSdk(subpath: string): Record<string, unknown> {
  const { openclawSdkRequire, projectSdkRequire } = getRuntimeSdkRequireContext();
  try {
    return openclawSdkRequire(subpath);
  } catch {
    return projectSdkRequire(subpath);
  }
}

/**
 * Load an openclaw extension API module by relative path under the openclaw
 * dist directory.  Falls back to no-op stubs when the optional dependency
 * tree is incomplete.
 */
function requireExtensionApi(relativePath: string): Record<string, unknown> | null {
  const { openclawSdkRequire, projectSdkRequire } = getRuntimeSdkRequireContext();
  try {
    // Require relative to the openclaw dist directory.
    return openclawSdkRequire(relativePath);
  } catch {
    try {
      return projectSdkRequire(relativePath);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Generic no-op stubs used when channel SDK is unavailable.
// ---------------------------------------------------------------------------

const noopAsyncList = async (..._args: unknown[]): Promise<unknown[]> => [];
const noopNormalize = (_target: string): string | undefined => undefined;

// ---------------------------------------------------------------------------
// Legacy plugin-sdk subpath imports (openclaw <2026.4.5)
// ---------------------------------------------------------------------------

function tryLegacySdkImport(subpath: string): Record<string, unknown> | null {
  try {
    return requireOpenClawSdk(subpath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Channel SDK loaders — try legacy plugin-sdk first, then extension api, then stubs
// ---------------------------------------------------------------------------

type ChannelSdk<T> = T;

interface DiscordSdk {
  listDiscordDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listDiscordDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeDiscordMessagingTarget: (target: string) => string | undefined;
}

interface TelegramSdk {
  listTelegramDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listTelegramDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeTelegramMessagingTarget: (target: string) => string | undefined;
}

interface SlackSdk {
  listSlackDirectoryGroupsFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  listSlackDirectoryPeersFromConfig: (...args: unknown[]) => Promise<unknown[]>;
  normalizeSlackMessagingTarget: (target: string) => string | undefined;
}

interface WhatsappSdk {
  normalizeWhatsAppMessagingTarget: (target: string) => string | undefined;
}

function loadChannelSdk<T>(
  legacySubpath: string,
  extensionRelPath: string,
  fallback: T,
  keys: (keyof T)[],
): ChannelSdk<T> {
  // 1. Try legacy plugin-sdk subpath (openclaw <4.5)
  const legacy = tryLegacySdkImport(legacySubpath);
  if (legacy && keys.every((k) => typeof legacy[k as string] === 'function')) {
    return legacy as unknown as T;
  }

  // 2. Try extension API file (openclaw >=4.5)
  const ext = requireExtensionApi(extensionRelPath);
  if (ext && keys.every((k) => typeof ext[k as string] === 'function')) {
    return ext as unknown as T;
  }

  // 3. Fallback to no-op stubs
  return fallback;
}

let channelSdkCache: {
  key: string;
  discord: DiscordSdk;
  telegram: TelegramSdk;
  slack: SlackSdk;
  whatsapp: WhatsappSdk;
} | null = null;

function getChannelSdkCache() {
  const { key } = getRuntimeSdkRequireContext();
  if (channelSdkCache?.key === key) {
    return channelSdkCache;
  }

  channelSdkCache = {
    key,
    discord: loadChannelSdk<DiscordSdk>(
      'openclaw/plugin-sdk/discord',
      './dist/extensions/discord/api.js',
      {
        listDiscordDirectoryGroupsFromConfig: noopAsyncList,
        listDiscordDirectoryPeersFromConfig: noopAsyncList,
        normalizeDiscordMessagingTarget: noopNormalize,
      },
      ['listDiscordDirectoryGroupsFromConfig', 'listDiscordDirectoryPeersFromConfig', 'normalizeDiscordMessagingTarget'],
    ),
    telegram: loadChannelSdk<TelegramSdk>(
      'openclaw/plugin-sdk/telegram-surface',
      './dist/extensions/telegram/api.js',
      {
        listTelegramDirectoryGroupsFromConfig: noopAsyncList,
        listTelegramDirectoryPeersFromConfig: noopAsyncList,
        normalizeTelegramMessagingTarget: noopNormalize,
      },
      ['listTelegramDirectoryGroupsFromConfig', 'listTelegramDirectoryPeersFromConfig', 'normalizeTelegramMessagingTarget'],
    ),
    slack: loadChannelSdk<SlackSdk>(
      'openclaw/plugin-sdk/slack',
      './dist/extensions/slack/api.js',
      {
        listSlackDirectoryGroupsFromConfig: noopAsyncList,
        listSlackDirectoryPeersFromConfig: noopAsyncList,
        normalizeSlackMessagingTarget: noopNormalize,
      },
      ['listSlackDirectoryGroupsFromConfig', 'listSlackDirectoryPeersFromConfig', 'normalizeSlackMessagingTarget'],
    ),
    whatsapp: loadChannelSdk<WhatsappSdk>(
      'openclaw/plugin-sdk/whatsapp-shared',
      './dist/extensions/whatsapp/api.js',
      {
        normalizeWhatsAppMessagingTarget: noopNormalize,
      },
      ['normalizeWhatsAppMessagingTarget'],
    ),
  };
  return channelSdkCache;
}

// ---------------------------------------------------------------------------
// Public re-exports — identical API surface as before.
// ---------------------------------------------------------------------------

export const listDiscordDirectoryGroupsFromConfig: DiscordSdk['listDiscordDirectoryGroupsFromConfig'] = async (...args) => (
  await getChannelSdkCache().discord.listDiscordDirectoryGroupsFromConfig(...args)
);
export const listDiscordDirectoryPeersFromConfig: DiscordSdk['listDiscordDirectoryPeersFromConfig'] = async (...args) => (
  await getChannelSdkCache().discord.listDiscordDirectoryPeersFromConfig(...args)
);
export const normalizeDiscordMessagingTarget: DiscordSdk['normalizeDiscordMessagingTarget'] = (target) => (
  getChannelSdkCache().discord.normalizeDiscordMessagingTarget(target)
);

export const listTelegramDirectoryGroupsFromConfig: TelegramSdk['listTelegramDirectoryGroupsFromConfig'] = async (...args) => (
  await getChannelSdkCache().telegram.listTelegramDirectoryGroupsFromConfig(...args)
);
export const listTelegramDirectoryPeersFromConfig: TelegramSdk['listTelegramDirectoryPeersFromConfig'] = async (...args) => (
  await getChannelSdkCache().telegram.listTelegramDirectoryPeersFromConfig(...args)
);
export const normalizeTelegramMessagingTarget: TelegramSdk['normalizeTelegramMessagingTarget'] = (target) => (
  getChannelSdkCache().telegram.normalizeTelegramMessagingTarget(target)
);

export const listSlackDirectoryGroupsFromConfig: SlackSdk['listSlackDirectoryGroupsFromConfig'] = async (...args) => (
  await getChannelSdkCache().slack.listSlackDirectoryGroupsFromConfig(...args)
);
export const listSlackDirectoryPeersFromConfig: SlackSdk['listSlackDirectoryPeersFromConfig'] = async (...args) => (
  await getChannelSdkCache().slack.listSlackDirectoryPeersFromConfig(...args)
);
export const normalizeSlackMessagingTarget: SlackSdk['normalizeSlackMessagingTarget'] = (target) => (
  getChannelSdkCache().slack.normalizeSlackMessagingTarget(target)
);

export const normalizeWhatsAppMessagingTarget: WhatsappSdk['normalizeWhatsAppMessagingTarget'] = (target) => (
  getChannelSdkCache().whatsapp.normalizeWhatsAppMessagingTarget(target)
);
