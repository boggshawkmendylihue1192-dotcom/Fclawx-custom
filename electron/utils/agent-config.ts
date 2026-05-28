import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join, normalize } from 'path';
import { deleteAgentChannelAccounts, listConfiguredChannels, readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import type { OpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import { expandPath, getOpenClawConfigDir } from './paths';
import * as logger from './logger';
import { toUiChannelType } from './channel-alias';
import { ensureClawXIdentityFile } from './openclaw-workspace';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main Agent';
const DEFAULT_ACCOUNT_ID = 'default';
const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace';
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
];
const AGENT_RUNTIME_FILES = [
  'auth-profiles.json',
  'models.json',
];

interface AgentModelConfig {
  primary?: string;
  [key: string]: unknown;
}

interface AgentToolsConfig extends Record<string, unknown> {
  profile?: string;
  alsoAllow?: string[];
}

interface AgentSubagentsConfig extends Record<string, unknown> {
  allowAgents?: string[];
  delegationMode?: 'suggest' | 'prefer';
  maxConcurrent?: number;
  maxSpawnDepth?: number;
  maxChildrenPerAgent?: number;
  runTimeoutSeconds?: number;
  requireAgentId?: boolean;
}

interface AgentDefaultsConfig {
  workspace?: string;
  model?: string | AgentModelConfig;
  subagents?: AgentSubagentsConfig;
  [key: string]: unknown;
}

interface AgentListEntry extends Record<string, unknown> {
  id: string;
  name?: string;
  description?: string;
  templateId?: string;
  toolPermissions?: AgentToolPermissions;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  model?: string | AgentModelConfig;
  tools?: AgentToolsConfig;
  subagents?: AgentSubagentsConfig;
}

interface AgentsConfig extends Record<string, unknown> {
  defaults?: AgentDefaultsConfig;
  list?: AgentListEntry[];
}

interface BindingMatch extends Record<string, unknown> {
  channel?: string;
  accountId?: string;
}

interface BindingConfig extends Record<string, unknown> {
  agentId?: string;
  match?: BindingMatch;
}

interface ChannelSectionConfig extends Record<string, unknown> {
  accounts?: Record<string, Record<string, unknown>>;
  defaultAccount?: string;
  enabled?: boolean;
}

interface AgentConfigDocument extends Record<string, unknown> {
  agents?: AgentsConfig;
  bindings?: BindingConfig[];
  channels?: Record<string, ChannelSectionConfig>;
  session?: {
    mainKey?: string;
    [key: string]: unknown;
  };
}

export interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  templateId?: string;
  toolPermissions: AgentToolPermissions;
  delegationConfig: AgentDelegationConfig;
  isDefault: boolean;
  modelDisplay: string;
  modelRef: string | null;
  overrideModelRef: string | null;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
}

export interface AgentToolPermissions {
  files: boolean;
  shell: boolean;
  browser: boolean;
  skills: boolean;
  memory: boolean;
  delegation: boolean;
}

export interface AgentDelegationConfig {
  enabled: boolean;
  allowAgents: string[];
  delegationMode: 'suggest' | 'prefer';
  maxConcurrent: number;
  maxSpawnDepth: number;
  maxChildrenPerAgent: number;
  runTimeoutSeconds: number;
  requireAgentId: boolean;
}

export interface AgentProfileUpdate {
  name?: string;
  description?: string;
  instructions?: string;
  templateId?: string;
  toolPermissions?: Partial<AgentToolPermissions>;
  delegationConfig?: Partial<AgentDelegationConfig>;
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}

const DEFAULT_TOOL_PERMISSIONS: AgentToolPermissions = {
  files: true,
  shell: true,
  browser: true,
  skills: true,
  memory: true,
  delegation: true,
};

const DELEGATION_TOOL_NAMES = ['sessions_spawn', 'sessions_yield', 'subagents', 'agents_list'];
const DEFAULT_DELEGATION_CONFIG: AgentDelegationConfig = {
  enabled: true,
  allowAgents: ['*'],
  delegationMode: 'prefer',
  maxConcurrent: 4,
  maxSpawnDepth: 2,
  maxChildrenPerAgent: 5,
  runTimeoutSeconds: 900,
  requireAgentId: true,
};

const AGENT_TEMPLATES: Record<string, {
  description: string;
  instructions: string;
  toolPermissions: AgentToolPermissions;
}> = {
  general: {
    description: 'General assistant for everyday reasoning and drafting.',
    instructions: 'You are a helpful general-purpose assistant. Be clear, practical, and concise.',
    toolPermissions: { ...DEFAULT_TOOL_PERMISSIONS },
  },
  coding: {
    description: 'Engineering agent for coding, debugging, and reviews.',
    instructions: 'You are a senior software engineering agent. Inspect the project before changing code, keep edits scoped, run relevant checks, and explain outcomes plainly.',
    toolPermissions: { ...DEFAULT_TOOL_PERMISSIONS },
  },
  research: {
    description: 'Research agent for gathering, comparing, and summarizing information.',
    instructions: 'You are a careful research agent. Verify claims, separate facts from inference, and summarize findings with source-aware reasoning.',
    toolPermissions: { ...DEFAULT_TOOL_PERMISSIONS, shell: false },
  },
  writing: {
    description: 'Writing agent for translation, polishing, and long-form drafting.',
    instructions: 'You are a writing and translation agent. Preserve intent, improve structure, and adapt tone to the target audience.',
    toolPermissions: { ...DEFAULT_TOOL_PERMISSIONS, shell: false, browser: false },
  },
  review: {
    description: 'Review agent focused on risks, bugs, and missing tests.',
    instructions: 'You are a code review agent. Lead with concrete findings ordered by severity, cite files and lines when available, and call out test gaps.',
    toolPermissions: { ...DEFAULT_TOOL_PERMISSIONS },
  },
};

function resolveModelRef(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }

  if (model && typeof model === 'object') {
    const primary = (model as AgentModelConfig).primary;
    if (typeof primary === 'string' && primary.trim()) {
      return primary.trim();
    }
  }

  return null;
}

function formatModelLabel(model: unknown): string | null {
  const modelRef = resolveModelRef(model);
  if (modelRef) {
    const trimmed = modelRef;
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }

  return null;
}

function normalizeAgentName(name: string): string {
  return name.trim() || 'Agent';
}

function normalizeAgentDescription(description: unknown): string {
  return typeof description === 'string' ? description.trim() : '';
}

function normalizeTemplateId(templateId: unknown): string {
  const candidate = typeof templateId === 'string' ? templateId.trim() : '';
  return candidate && AGENT_TEMPLATES[candidate] ? candidate : 'general';
}

function normalizeToolPermissions(value: unknown): AgentToolPermissions {
  const source = value && typeof value === 'object' ? value as Partial<AgentToolPermissions> : {};
  return {
    files: typeof source.files === 'boolean' ? source.files : DEFAULT_TOOL_PERMISSIONS.files,
    shell: typeof source.shell === 'boolean' ? source.shell : DEFAULT_TOOL_PERMISSIONS.shell,
    browser: typeof source.browser === 'boolean' ? source.browser : DEFAULT_TOOL_PERMISSIONS.browser,
    skills: typeof source.skills === 'boolean' ? source.skills : DEFAULT_TOOL_PERMISSIONS.skills,
    memory: typeof source.memory === 'boolean' ? source.memory : DEFAULT_TOOL_PERMISSIONS.memory,
    delegation: typeof source.delegation === 'boolean' ? source.delegation : DEFAULT_TOOL_PERMISSIONS.delegation,
  };
}

function normalizeDelegationMode(value: unknown): 'suggest' | 'prefer' {
  return value === 'suggest' || value === 'prefer' ? value : DEFAULT_DELEGATION_CONFIG.delegationMode;
}

function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numberValue)));
}

function normalizeDelegationConfig(value: unknown, permissions?: AgentToolPermissions): AgentDelegationConfig {
  const source = value && typeof value === 'object' ? value as Partial<AgentDelegationConfig> & AgentSubagentsConfig : {};
  const allowAgents = Array.isArray(source.allowAgents) && source.allowAgents.length > 0
    ? uniqueStrings(source.allowAgents)
    : [...DEFAULT_DELEGATION_CONFIG.allowAgents];
  return {
    enabled: permissions ? permissions.delegation : source.enabled !== false,
    allowAgents: allowAgents.length > 0 ? allowAgents : [...DEFAULT_DELEGATION_CONFIG.allowAgents],
    delegationMode: normalizeDelegationMode(source.delegationMode),
    maxConcurrent: normalizePositiveInteger(source.maxConcurrent, DEFAULT_DELEGATION_CONFIG.maxConcurrent, 1, 16),
    maxSpawnDepth: normalizePositiveInteger(source.maxSpawnDepth, DEFAULT_DELEGATION_CONFIG.maxSpawnDepth, 1, 5),
    maxChildrenPerAgent: normalizePositiveInteger(source.maxChildrenPerAgent, DEFAULT_DELEGATION_CONFIG.maxChildrenPerAgent, 1, 20),
    runTimeoutSeconds: normalizePositiveInteger(source.runTimeoutSeconds, DEFAULT_DELEGATION_CONFIG.runTimeoutSeconds, 0, 86_400),
    requireAgentId: typeof source.requireAgentId === 'boolean' ? source.requireAgentId : DEFAULT_DELEGATION_CONFIG.requireAgentId,
  };
}

function toSubagentsConfig(value: AgentDelegationConfig): AgentSubagentsConfig {
  return {
    allowAgents: value.allowAgents,
    delegationMode: value.delegationMode,
    maxConcurrent: value.maxConcurrent,
    maxSpawnDepth: value.maxSpawnDepth,
    maxChildrenPerAgent: value.maxChildrenPerAgent,
    runTimeoutSeconds: value.runTimeoutSeconds,
    requireAgentId: value.requireAgentId,
  };
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))];
}

function ensureDelegationConfig(config: AgentConfigDocument, entries: AgentListEntry[]): void {
  const agentIds = entries.map((entry) => entry.id).filter(Boolean);
  const agentsConfig = config.agents && typeof config.agents === 'object' ? config.agents : {};
  const defaults = agentsConfig.defaults && typeof agentsConfig.defaults === 'object' ? agentsConfig.defaults : {};
  const existingSubagents = defaults.subagents && typeof defaults.subagents === 'object' ? defaults.subagents : {};

  config.agents = {
    ...agentsConfig,
    defaults: {
      ...defaults,
      subagents: {
        ...existingSubagents,
        allowAgents: Array.isArray(existingSubagents.allowAgents) && existingSubagents.allowAgents.length > 0
          ? existingSubagents.allowAgents
          : DEFAULT_DELEGATION_CONFIG.allowAgents,
        delegationMode: existingSubagents.delegationMode || DEFAULT_DELEGATION_CONFIG.delegationMode,
        maxConcurrent: typeof existingSubagents.maxConcurrent === 'number' ? existingSubagents.maxConcurrent : DEFAULT_DELEGATION_CONFIG.maxConcurrent,
        maxSpawnDepth: typeof existingSubagents.maxSpawnDepth === 'number' ? Math.max(existingSubagents.maxSpawnDepth, 2) : DEFAULT_DELEGATION_CONFIG.maxSpawnDepth,
        maxChildrenPerAgent: typeof existingSubagents.maxChildrenPerAgent === 'number' ? existingSubagents.maxChildrenPerAgent : DEFAULT_DELEGATION_CONFIG.maxChildrenPerAgent,
        runTimeoutSeconds: typeof existingSubagents.runTimeoutSeconds === 'number' ? existingSubagents.runTimeoutSeconds : DEFAULT_DELEGATION_CONFIG.runTimeoutSeconds,
        requireAgentId: typeof existingSubagents.requireAgentId === 'boolean' ? existingSubagents.requireAgentId : DEFAULT_DELEGATION_CONFIG.requireAgentId,
      },
    },
  };

  for (const entry of entries) {
    const permissions = normalizeToolPermissions(entry.toolPermissions);
    const existingTools = entry.tools && typeof entry.tools === 'object' ? entry.tools : {};
    const delegationConfig = normalizeDelegationConfig(entry.subagents, permissions);
    const existingSubagents = entry.subagents && typeof entry.subagents === 'object' ? entry.subagents : {};
    entry.tools = permissions.delegation
      ? {
        ...existingTools,
        profile: existingTools.profile || 'coding',
        alsoAllow: uniqueStrings([...(existingTools.alsoAllow || []), ...DELEGATION_TOOL_NAMES]),
      }
      : {
        ...existingTools,
        alsoAllow: Array.isArray(existingTools.alsoAllow)
          ? existingTools.alsoAllow.filter((tool) => !DELEGATION_TOOL_NAMES.includes(tool))
          : existingTools.alsoAllow,
      };
    entry.subagents = permissions.delegation
      ? {
        ...existingSubagents,
        ...toSubagentsConfig(delegationConfig),
      }
      : existingSubagents;
  }

  void agentIds;
}

function slugifyAgentId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized || /^\d+$/.test(normalized)) return 'agent';
  if (normalized === MAIN_AGENT_ID) return 'agent';
  return normalized;
}

function getAgentWorkspacePath(config: AgentConfigDocument, entry: AgentListEntry): string {
  return expandPath(entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${entry.id}`));
}

function getAgentSoulPath(config: AgentConfigDocument, entry: AgentListEntry): string {
  return join(getAgentWorkspacePath(config, entry), 'SOUL.md');
}

function getAgentToolsPath(config: AgentConfigDocument, entry: AgentListEntry): string {
  return join(getAgentWorkspacePath(config, entry), 'TOOLS.md');
}

async function readAgentInstructions(config: AgentConfigDocument, entry: AgentListEntry): Promise<string> {
  try {
    return (await readFile(getAgentSoulPath(config, entry), 'utf-8')).trim();
  } catch {
    const templateId = normalizeTemplateId(entry.templateId);
    return AGENT_TEMPLATES[templateId]?.instructions ?? AGENT_TEMPLATES.general.instructions;
  }
}

function buildToolPermissionsBlock(permissions: AgentToolPermissions): string {
  const rows = [
    `- Files: ${permissions.files ? 'enabled' : 'disabled'}`,
    `- Shell: ${permissions.shell ? 'enabled' : 'disabled'}`,
    `- Browser: ${permissions.browser ? 'enabled' : 'disabled'}`,
    `- Skills: ${permissions.skills ? 'enabled' : 'disabled'}`,
    `- Memory: ${permissions.memory ? 'enabled' : 'disabled'}`,
    `- Delegation: ${permissions.delegation ? 'enabled' : 'disabled'}`,
  ];
  return [
    '<!-- CLAWX_AGENT_TOOL_PERMISSIONS_START -->',
    '# ClawX Tool Permissions',
    '',
    ...rows,
    '',
    'Follow these permissions when deciding whether to use tools for this agent.',
    'When Delegation is enabled and a task benefits from another configured agent, inspect agents_list, use sessions_spawn with an explicit agentId, and call sessions_yield when you need child results before the final answer.',
    'Do not poll subagents, sessions_list, or sessions_history in a loop just to wait for completion; wait for completion events or yield once when needed.',
    '<!-- CLAWX_AGENT_TOOL_PERMISSIONS_END -->',
  ].join('\n');
}

function mergeManagedBlock(content: string, block: string): string {
  const pattern = /<!-- CLAWX_AGENT_TOOL_PERMISSIONS_START -->[\s\S]*?<!-- CLAWX_AGENT_TOOL_PERMISSIONS_END -->/;
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  return `${content.trim()}\n\n${block}\n`;
}

async function writeAgentInstructions(config: AgentConfigDocument, entry: AgentListEntry, instructions: string): Promise<void> {
  const workspace = getAgentWorkspacePath(config, entry);
  await ensureDir(workspace);
  await writeFile(getAgentSoulPath(config, entry), `${instructions.trim() || AGENT_TEMPLATES.general.instructions}\n`, 'utf-8');
}

async function writeAgentToolPermissions(config: AgentConfigDocument, entry: AgentListEntry): Promise<void> {
  const workspace = getAgentWorkspacePath(config, entry);
  await ensureDir(workspace);
  const toolsPath = getAgentToolsPath(config, entry);
  let existing = '';
  try {
    existing = await readFile(toolsPath, 'utf-8');
  } catch {
    existing = '# Tools\n';
  }
  const permissions = normalizeToolPermissions(entry.toolPermissions);
  await writeFile(toolsPath, mergeManagedBlock(existing, buildToolPermissionsBlock(permissions)), 'utf-8');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : DEFAULT_WORKSPACE_PATH;
}

function getDefaultAgentDirPath(agentId: string): string {
  return `~/.openclaw/agents/${agentId}/agent`;
}

function createImplicitMainEntry(config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
    workspace: getDefaultWorkspacePath(config),
    agentDir: getDefaultAgentDirPath(MAIN_AGENT_ID),
  };
}

function normalizeAgentsConfig(config: AgentConfigDocument): {
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
  syntheticMain: boolean;
} {
  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  const rawEntries = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];

  if (rawEntries.length === 0) {
    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = rawEntries.find((entry) => entry.default) ?? rawEntries[0];
  return {
    agentsConfig,
    entries: rawEntries.map((entry) => ({ ...entry })),
    defaultAgentId: defaultEntry.id,
    syntheticMain: false,
  };
}

function isChannelBinding(binding: unknown): binding is BindingConfig {
  if (!binding || typeof binding !== 'object') return false;
  const candidate = binding as BindingConfig;
  if (typeof candidate.agentId !== 'string' || !candidate.agentId) return false;
  if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
  if (typeof candidate.match.channel !== 'string' || !candidate.match.channel) return false;
  const keys = Object.keys(candidate.match);
  // Accept bindings with just {channel} or {channel, accountId}
  if (keys.length === 1 && keys[0] === 'channel') return true;
  if (keys.length === 2 && keys.includes('channel') && keys.includes('accountId')) return true;
  return false;
}

/** Normalize agent ID for consistent comparison (bindings vs entries). */
function normalizeAgentIdForBinding(id: string): string {
  return (id ?? '').trim().toLowerCase() || '';
}

function normalizeMainKey(value: unknown): string {
  if (typeof value !== 'string') return 'main';
  const trimmed = value.trim().toLowerCase();
  return trimmed || 'main';
}

function buildAgentMainSessionKey(config: AgentConfigDocument, agentId: string): string {
  return `agent:${normalizeAgentIdForBinding(agentId) || MAIN_AGENT_ID}:${normalizeMainKey(config.session?.mainKey)}`;
}

/**
 * Returns a map of channelType -> agentId from bindings.
 * Account-scoped bindings are preferred; channel-wide bindings serve as fallback.
 * Multiple agents can own the same channel type (different accounts).
 */
function getChannelBindingMap(bindings: unknown): {
  channelToAgent: Map<string, string>;
  accountToAgent: Map<string, string>;
} {
  const channelToAgent = new Map<string, string>();
  const accountToAgent = new Map<string, string>();
  if (!Array.isArray(bindings)) return { channelToAgent, accountToAgent };

  for (const binding of bindings) {
    if (!isChannelBinding(binding)) continue;
    const agentId = normalizeAgentIdForBinding(binding.agentId!);
    const channel = binding.match?.channel;
    if (!agentId || !channel) continue;

    const accountId = binding.match?.accountId;
    if (accountId) {
      accountToAgent.set(`${channel}:${accountId}`, agentId);
    } else {
      channelToAgent.set(channel, agentId);
    }
  }

  return { channelToAgent, accountToAgent };
}

function upsertBindingsForChannel(
  bindings: unknown,
  channelType: string,
  agentId: string | null,
  accountId?: string,
): BindingConfig[] | undefined {
  const normalizedAccountId = accountId?.trim() || '';
  const nextBindings = Array.isArray(bindings)
    ? [...bindings as BindingConfig[]].filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      if (binding.match?.channel !== channelType) return true;

      const bindingAccountId = typeof binding.match?.accountId === 'string'
        ? binding.match.accountId.trim()
        : '';

      // Account-scoped updates must only replace the exact account owner.
      // Otherwise rebinding one Feishu/Lark account can silently drop a
      // sibling account binding on the same agent, which looks like routing
      // or model config "drift" in multi-account setups.
      if (normalizedAccountId) {
        return bindingAccountId !== normalizedAccountId;
      }

      // No accountId: remove channel-wide binding (legacy)
      return Boolean(bindingAccountId);
    })
    : [];

  if (agentId) {
    const match: BindingMatch = { channel: channelType };
    if (normalizedAccountId) {
      match.accountId = normalizedAccountId;
    }
    nextBindings.push({ agentId, match });
  }

  return nextBindings.length > 0 ? nextBindings : undefined;
}

async function listExistingAgentIdsOnDisk(): Promise<Set<string>> {
  const ids = new Set<string>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  try {
    if (!(await fileExists(agentsDir))) return ids;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // ignore discovery failures
  }

  return ids;
}

async function removeAgentRuntimeDirectory(agentId: string): Promise<void> {
  const runtimeDir = join(getOpenClawConfigDir(), 'agents', agentId);
  try {
    await rm(runtimeDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent runtime directory', {
      agentId,
      runtimeDir,
      error: String(error),
    });
  }
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function getManagedWorkspaceDirectory(agent: AgentListEntry): string | null {
  if (agent.id === MAIN_AGENT_ID) return null;

  const configuredWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const managedWorkspace = join(getOpenClawConfigDir(), `workspace-${agent.id}`);
  const normalizedConfigured = trimTrailingSeparators(normalize(configuredWorkspace));
  const normalizedManaged = trimTrailingSeparators(normalize(managedWorkspace));

  return normalizedConfigured === normalizedManaged ? configuredWorkspace : null;
}

export async function removeAgentWorkspaceDirectory(agent: { id: string; workspace?: string }): Promise<void> {
  const workspaceDir = getManagedWorkspaceDirectory(agent as AgentListEntry);
  if (!workspaceDir) {
    logger.warn('Skipping agent workspace deletion for unmanaged path', {
      agentId: agent.id,
      workspace: agent.workspace,
    });
    return;
  }

  try {
    await rm(workspaceDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent workspace directory', {
      agentId: agent.id,
      workspaceDir,
      error: String(error),
    });
  }
}

async function copyBootstrapFiles(sourceWorkspace: string, targetWorkspace: string): Promise<void> {
  await ensureDir(targetWorkspace);

  for (const fileName of AGENT_BOOTSTRAP_FILES) {
    const source = join(sourceWorkspace, fileName);
    const target = join(targetWorkspace, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function copyRuntimeFiles(sourceAgentDir: string, targetAgentDir: string): Promise<void> {
  await ensureDir(targetAgentDir);

  for (const fileName of AGENT_RUNTIME_FILES) {
    const source = join(sourceAgentDir, fileName);
    const target = join(targetAgentDir, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function provisionAgentFilesystem(
  config: AgentConfigDocument,
  agent: AgentListEntry,
  options?: { inheritWorkspace?: boolean },
): Promise<void> {
  const { entries } = normalizeAgentsConfig(config);
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
  const sourceWorkspace = expandPath(mainEntry.workspace || getDefaultWorkspacePath(config));
  const targetWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const sourceAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
  const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));
  const targetSessionsDir = join(getOpenClawConfigDir(), 'agents', agent.id, 'sessions');

  await ensureDir(targetWorkspace);
  await ensureDir(targetAgentDir);
  await ensureDir(targetSessionsDir);

  // When inheritWorkspace is true, copy the main agent's workspace bootstrap
  // files (SOUL.md, AGENTS.md, etc.) so the new agent inherits the same
  // personality / instructions. Otherwise OpenClaw will seed the missing files
  // on first use, but ClawX still pre-seeds IDENTITY.md so desktop workspaces
  // skip the chat-first bootstrap flow.
  if (options?.inheritWorkspace && targetWorkspace !== sourceWorkspace) {
    await copyBootstrapFiles(sourceWorkspace, targetWorkspace);
  }
  await ensureClawXIdentityFile(targetWorkspace, { createDir: true });
  if (targetAgentDir !== sourceAgentDir) {
    await copyRuntimeFiles(sourceAgentDir, targetAgentDir);
  }
}

export function resolveAccountIdForAgent(agentId: string): string {
  return agentId === MAIN_AGENT_ID ? DEFAULT_ACCOUNT_ID : agentId;
}

function listConfiguredAccountIdsForChannel(config: AgentConfigDocument, channelType: string): string[] {
  const channelSection = config.channels?.[channelType];
  if (!channelSection || channelSection.enabled === false) {
    return [];
  }

  const accounts = channelSection.accounts;
  if (!accounts || typeof accounts !== 'object' || Object.keys(accounts).length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return Object.keys(accounts)
    .filter(Boolean)
    .sort((a, b) => {
      if (a === DEFAULT_ACCOUNT_ID) return -1;
      if (b === DEFAULT_ACCOUNT_ID) return 1;
      return a.localeCompare(b);
    });
}

async function buildSnapshotFromConfig(config: AgentConfigDocument, preloadedChannels?: string[]): Promise<AgentsSnapshot> {
  const { entries, defaultAgentId } = normalizeAgentsConfig(config);
  const configuredChannels = preloadedChannels ?? await listConfiguredChannels();
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);
  const defaultAgentIdNorm = normalizeAgentIdForBinding(defaultAgentId);
  const channelOwners: Record<string, string> = {};
  const channelAccountOwners: Record<string, string> = {};

  // Build per-agent channel lists from account-scoped bindings
  const agentChannelSets = new Map<string, Set<string>>();

  for (const channelType of configuredChannels) {
    const accountIds = listConfiguredAccountIdsForChannel(config, channelType);
    let primaryOwner: string | undefined;
    const hasExplicitAccountBindingForChannel = accountIds.some((accountId) =>
      accountToAgent.has(`${channelType}:${accountId}`),
    );

    for (const accountId of accountIds) {
      const owner =
        accountToAgent.get(`${channelType}:${accountId}`)
        || (
          accountId === DEFAULT_ACCOUNT_ID && !hasExplicitAccountBindingForChannel
            ? channelToAgent.get(channelType)
            : undefined
        );

      if (!owner) {
        continue;
      }

      channelAccountOwners[`${channelType}:${accountId}`] = owner;
      primaryOwner ??= owner;
      const existing = agentChannelSets.get(owner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(owner, existing);
    }

    if (!primaryOwner) {
      primaryOwner = channelToAgent.get(channelType) || defaultAgentIdNorm;
      const existing = agentChannelSets.get(primaryOwner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(primaryOwner, existing);
    }

    channelOwners[channelType] = primaryOwner;
  }

  const defaultModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.model;
  const defaultModelLabel = formatModelLabel(defaultModelConfig);
  const defaultModelRef = resolveModelRef(defaultModelConfig);
  const agents: AgentSummary[] = await Promise.all(entries.map(async (entry) => {
    const explicitModelRef = resolveModelRef(entry.model);
    const modelLabel = formatModelLabel(entry.model) || defaultModelLabel || 'Not configured';
    const inheritedModel = !explicitModelRef && Boolean(defaultModelLabel);
    const entryIdNorm = normalizeAgentIdForBinding(entry.id);
    const ownedChannels = agentChannelSets.get(entryIdNorm) ?? new Set<string>();
    return {
      id: entry.id,
      name: entry.name || (entry.id === MAIN_AGENT_ID ? MAIN_AGENT_NAME : entry.id),
      description: normalizeAgentDescription(entry.description),
      instructions: await readAgentInstructions(config, entry),
      templateId: normalizeTemplateId(entry.templateId),
      toolPermissions: normalizeToolPermissions(entry.toolPermissions),
      delegationConfig: normalizeDelegationConfig(entry.subagents, normalizeToolPermissions(entry.toolPermissions)),
      isDefault: entry.id === defaultAgentId,
      modelDisplay: modelLabel,
      modelRef: explicitModelRef || defaultModelRef || null,
      overrideModelRef: explicitModelRef,
      inheritedModel,
      workspace: entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${entry.id}`),
      agentDir: entry.agentDir || getDefaultAgentDirPath(entry.id),
      mainSessionKey: buildAgentMainSessionKey(config, entry.id),
      channelTypes: configuredChannels
        .filter((ct) => ownedChannels.has(ct))
        .map((channelType) => toUiChannelType(channelType)),
    };
  }));

  return {
    agents,
    defaultAgentId,
    defaultModelRef,
    configuredChannelTypes: configuredChannels.map((channelType) => toUiChannelType(channelType)),
    channelOwners,
    channelAccountOwners,
  };
}

export async function listAgentsSnapshot(): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const before = JSON.stringify(config.agents);
  const { entries } = normalizeAgentsConfig(config);
  ensureDelegationConfig(config, entries);
  if (JSON.stringify(config.agents) !== before) {
    await writeOpenClawConfig(config);
  }
  return buildSnapshotFromConfig(config);
}

export async function listAgentsSnapshotFromConfig(config: OpenClawConfig, configuredChannels?: string[]): Promise<AgentsSnapshot> {
  return buildSnapshotFromConfig(config as AgentConfigDocument, configuredChannels);
}

export async function listConfiguredAgentIds(): Promise<string[]> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  const ids = [...new Set(entries.map((entry) => entry.id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : [MAIN_AGENT_ID];
}

/**
 * Resolve agentId from channel and accountId using bindings.
 * Returns the agentId if found, or null if no binding exists.
 */
export async function resolveAgentIdFromChannel(channel: string, accountId?: string): Promise<string | null> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);

  // First try account-specific binding
  if (accountId) {
    const agentId = accountToAgent.get(`${channel}:${accountId}`);
    if (agentId) return agentId;
  }

  // Fallback to channel-only binding
  const agentId = channelToAgent.get(channel);
  return agentId ?? null;
}

export async function createAgent(
  name: string,
  options?: {
    inheritWorkspace?: boolean;
    templateId?: string;
    description?: string;
    instructions?: string;
    toolPermissions?: Partial<AgentToolPermissions>;
    delegationConfig?: Partial<AgentDelegationConfig>;
  },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
    const normalizedName = normalizeAgentName(name);
    const existingIds = new Set(entries.map((entry) => entry.id));
    const diskIds = await listExistingAgentIdsOnDisk();
    let nextId = slugifyAgentId(normalizedName);
    let suffix = 2;

    while (existingIds.has(nextId) || diskIds.has(nextId)) {
      nextId = `${slugifyAgentId(normalizedName)}-${suffix}`;
      suffix += 1;
    }

    const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.filter((_, index) => index > 0)] : [...entries];
    const newAgent: AgentListEntry = {
      id: nextId,
      name: normalizedName,
      description: normalizeAgentDescription(options?.description || AGENT_TEMPLATES[normalizeTemplateId(options?.templateId)]?.description),
      templateId: normalizeTemplateId(options?.templateId),
      toolPermissions: normalizeToolPermissions(options?.toolPermissions || AGENT_TEMPLATES[normalizeTemplateId(options?.templateId)]?.toolPermissions),
      workspace: `~/.openclaw/workspace-${nextId}`,
      agentDir: getDefaultAgentDirPath(nextId),
    };
    newAgent.subagents = toSubagentsConfig(normalizeDelegationConfig(options?.delegationConfig, newAgent.toolPermissions));

    if (!nextEntries.some((entry) => entry.id === MAIN_AGENT_ID) && syntheticMain) {
      nextEntries.unshift(createImplicitMainEntry(config));
    }
    nextEntries.push(newAgent);
    ensureDelegationConfig(config, nextEntries);

    config.agents = {
      ...(config.agents || agentsConfig),
      list: nextEntries,
    };

    await provisionAgentFilesystem(config, newAgent, { inheritWorkspace: options?.inheritWorkspace });
    await writeAgentInstructions(
      config,
      newAgent,
      options?.instructions || AGENT_TEMPLATES[newAgent.templateId || 'general']?.instructions || AGENT_TEMPLATES.general.instructions,
    );
    await writeAgentToolPermissions(config, newAgent);
    await writeOpenClawConfig(config);
    logger.info('Created agent config entry', { agentId: nextId, inheritWorkspace: !!options?.inheritWorkspace });
    return buildSnapshotFromConfig(config);
  });
}

export async function updateAgentName(agentId: string, name: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const normalizedName = normalizeAgentName(name);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    entries[index] = {
      ...entries[index],
      name: normalizedName,
    };

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info('Updated agent name', { agentId, name: normalizedName });
    return buildSnapshotFromConfig(config);
  });
}

export async function updateAgentProfile(agentId: string, update: AgentProfileUpdate): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const currentEntry = entries[index];
    const templateId = update.templateId !== undefined
      ? normalizeTemplateId(update.templateId)
      : normalizeTemplateId(currentEntry.templateId);
    const template = AGENT_TEMPLATES[templateId] ?? AGENT_TEMPLATES.general;
    const nextEntry: AgentListEntry = {
      ...currentEntry,
      templateId,
      description: update.description !== undefined
        ? normalizeAgentDescription(update.description)
        : normalizeAgentDescription(currentEntry.description || template.description),
      toolPermissions: normalizeToolPermissions({
        ...normalizeToolPermissions(currentEntry.toolPermissions || template.toolPermissions),
        ...(update.toolPermissions || {}),
      }),
    };
    nextEntry.subagents = toSubagentsConfig(normalizeDelegationConfig({
      ...(currentEntry.subagents || {}),
      ...(update.delegationConfig || {}),
    }, nextEntry.toolPermissions));

    if (typeof update.name === 'string' && !nextEntry.default) {
      nextEntry.name = normalizeAgentName(update.name);
    }

    entries[index] = nextEntry;
    ensureDelegationConfig(config, entries);
    config.agents = {
      ...(config.agents || agentsConfig),
      list: entries,
    };

    if (typeof update.instructions === 'string') {
      await writeAgentInstructions(config, nextEntry, update.instructions);
    }
    await writeAgentToolPermissions(config, nextEntry);
    await writeOpenClawConfig(config);
    logger.info('Updated agent profile', { agentId, templateId });
    return buildSnapshotFromConfig(config);
  });
}

function isValidModelRef(modelRef: string): boolean {
  const firstSlash = modelRef.indexOf('/');
  return firstSlash > 0 && firstSlash < modelRef.length - 1;
}

export async function updateAgentModel(agentId: string, modelRef: string | null): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const normalizedModelRef = typeof modelRef === 'string' ? modelRef.trim() : '';
    const nextEntry: AgentListEntry = { ...entries[index] };

    if (!normalizedModelRef) {
      delete nextEntry.model;
    } else {
      if (!isValidModelRef(normalizedModelRef)) {
        throw new Error('modelRef must be in "provider/model" format');
      }
      nextEntry.model = { primary: normalizedModelRef };
    }

    entries[index] = nextEntry;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info('Updated agent model', { agentId, modelRef: normalizedModelRef || null });
    return buildSnapshotFromConfig(config);
  });
}

export async function deleteAgentConfig(agentId: string): Promise<{ snapshot: AgentsSnapshot; removedEntry: AgentListEntry }> {
  return withConfigLock(async () => {
    if (agentId === MAIN_AGENT_ID) {
      throw new Error('The main agent cannot be deleted');
    }

    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
    const snapshotBeforeDeletion = await buildSnapshotFromConfig(config);
    const removedEntry = entries.find((entry) => entry.id === agentId);
    const nextEntries = entries.filter((entry) => entry.id !== agentId);
    if (!removedEntry || nextEntries.length === entries.length) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };
    config.bindings = Array.isArray(config.bindings)
      ? config.bindings.filter((binding) => !(isChannelBinding(binding) && binding.agentId === agentId))
      : undefined;

    if (defaultAgentId === agentId && nextEntries.length > 0) {
      nextEntries[0] = {
        ...nextEntries[0],
        default: true,
      };
    }

    const normalizedAgentId = normalizeAgentIdForBinding(agentId);
    const legacyAccountId = resolveAccountIdForAgent(agentId);
    const ownedLegacyAccounts = new Set(
      Object.entries(snapshotBeforeDeletion.channelAccountOwners)
        .filter(([channelAccountKey, owner]) => {
          if (owner !== normalizedAgentId) return false;
          const accountId = channelAccountKey.slice(channelAccountKey.indexOf(':') + 1);
          return accountId === legacyAccountId;
        })
        .map(([channelAccountKey]) => channelAccountKey),
    );

    await writeOpenClawConfig(config);
    await deleteAgentChannelAccounts(agentId, ownedLegacyAccounts);
    await removeAgentRuntimeDirectory(agentId);
    // NOTE: workspace directory is NOT deleted here intentionally.
    // The caller (route handler) defers workspace removal until after
    // the Gateway process has fully restarted, so that any in-flight
    // process.chdir(workspace) calls complete before the directory
    // disappears (otherwise process.cwd() throws ENOENT for the rest
    // of the Gateway's lifetime).
    logger.info('Deleted agent config entry', { agentId });
    return { snapshot: await buildSnapshotFromConfig(config), removedEntry };
  });
}

export async function assignChannelToAgent(agentId: string, channelType: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const accountId = resolveAccountIdForAgent(agentId);
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId);
    await writeOpenClawConfig(config);
    logger.info('Assigned channel to agent', { agentId, channelType, accountId });
    return buildSnapshotFromConfig(config);
  });
}

export async function assignChannelAccountToAgent(
  agentId: string,
  channelType: string,
  accountId: string,
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    if (!accountId.trim()) {
      throw new Error('accountId is required');
    }

    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId.trim());
    await writeOpenClawConfig(config);
    logger.info('Assigned channel account to agent', { agentId, channelType, accountId: accountId.trim() });
    return buildSnapshotFromConfig(config);
  });
}

export async function clearChannelBinding(channelType: string, accountId?: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, null, accountId);
    await writeOpenClawConfig(config);
    logger.info('Cleared channel binding', { channelType, accountId });
    return buildSnapshotFromConfig(config);
  });
}

export async function clearAllBindingsForChannel(channelType: string): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    if (!Array.isArray(config.bindings)) return;

    const nextBindings = config.bindings.filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      return binding.match?.channel !== channelType;
    });

    config.bindings = nextBindings.length > 0 ? nextBindings : undefined;
    await writeOpenClawConfig(config);
    logger.info('Cleared all bindings for channel', { channelType });
  });
}
