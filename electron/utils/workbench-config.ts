import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { withConfigLock } from './config-mutex';
import { getOpenClawConfigDir } from './paths';

export interface WorkbenchProject {
  id: string;
  name: string;
  description: string;
  agentId: string;
  workspace: string;
  status: 'active' | 'paused';
  createdAt: number;
  updatedAt: number;
}

export interface WorkbenchMemory {
  id: string;
  projectId: string;
  title: string;
  content: string;
  source: string;
  confidence: 'low' | 'medium' | 'high';
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

export interface AlwaysOnTask {
  id: string;
  projectId: string;
  title: string;
  cadence: 'manual' | 'hourly' | 'daily' | 'weekly';
  objective: string;
  status: 'active' | 'paused';
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  lastRunStatus?: 'queued' | 'running' | 'completed' | 'failed';
  lastRunSessionKey?: string;
  lastRunError?: string;
  failureCount: number;
  nextRunHint?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RoutingRule {
  id: string;
  name: string;
  matcher: string;
  complexity: 'simple' | 'normal' | 'hard';
  preferredModelStrategy: 'fast' | 'balanced' | 'quality';
  targetAgentId: string;
  notes?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkbenchReport {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  status: 'draft' | 'final';
  runId?: string;
  taskId?: string;
  agentId?: string;
  durationMs?: number;
  createdAt: number;
}

export interface WorkbenchSnapshot {
  projects: WorkbenchProject[];
  memories: WorkbenchMemory[];
  alwaysOnTasks: AlwaysOnTask[];
  routingRules: RoutingRule[];
  reports: WorkbenchReport[];
}

const WORKBENCH_FILE = 'clawx-workbench.json';

const emptySnapshot: WorkbenchSnapshot = {
  projects: [],
  memories: [],
  alwaysOnTasks: [],
  routingRules: [],
  reports: [],
};

function workbenchPath(): string {
  return join(getOpenClawConfigDir(), WORKBENCH_FILE);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function time(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function normalizeProject(input: Partial<WorkbenchProject>): WorkbenchProject {
  const now = Date.now();
  return {
    id: text(input.id) || randomUUID(),
    name: text(input.name, '新工作区'),
    description: typeof input.description === 'string' ? input.description : '',
    agentId: text(input.agentId, 'main'),
    workspace: typeof input.workspace === 'string' ? input.workspace : '',
    status: input.status === 'paused' ? 'paused' : 'active',
    createdAt: time(input.createdAt ?? now),
    updatedAt: time(input.updatedAt ?? now),
  };
}

function normalizeMemory(input: Partial<WorkbenchMemory>): WorkbenchMemory {
  const now = Date.now();
  return {
    id: text(input.id) || randomUUID(),
    projectId: text(input.projectId),
    title: text(input.title, '记忆条目'),
    content: typeof input.content === 'string' ? input.content : '',
    source: text(input.source, 'manual'),
    confidence: input.confidence === 'low' || input.confidence === 'high' ? input.confidence : 'medium',
    status: input.status === 'archived' ? 'archived' : 'active',
    createdAt: time(input.createdAt ?? now),
    updatedAt: time(input.updatedAt ?? now),
  };
}

function normalizeTask(input: Partial<AlwaysOnTask>): AlwaysOnTask {
  const now = Date.now();
  const cadence = input.cadence === 'hourly' || input.cadence === 'daily' || input.cadence === 'weekly'
    ? input.cadence
    : 'manual';
  return {
    id: text(input.id) || randomUUID(),
    projectId: text(input.projectId),
    title: text(input.title, '后台任务'),
    cadence,
    objective: typeof input.objective === 'string' ? input.objective : '',
    status: input.status === 'paused' ? 'paused' : 'active',
    lastRunAt: typeof input.lastRunAt === 'number' ? input.lastRunAt : undefined,
    nextRunAt: typeof input.nextRunAt === 'number' ? input.nextRunAt : computeNextRunAt(cadence, input.lastRunAt),
    runCount: typeof input.runCount === 'number' && Number.isFinite(input.runCount) ? Math.max(0, Math.floor(input.runCount)) : 0,
    lastRunStatus: input.lastRunStatus,
    lastRunSessionKey: text(input.lastRunSessionKey) || undefined,
    lastRunError: text(input.lastRunError) || undefined,
    failureCount: typeof input.failureCount === 'number' && Number.isFinite(input.failureCount) ? Math.max(0, Math.floor(input.failureCount)) : 0,
    nextRunHint: typeof input.nextRunHint === 'string' ? input.nextRunHint : undefined,
    createdAt: time(input.createdAt ?? now),
    updatedAt: time(input.updatedAt ?? now),
  };
}

function normalizeRule(input: Partial<RoutingRule>): RoutingRule {
  const now = Date.now();
  return {
    id: text(input.id) || randomUUID(),
    name: text(input.name, '路由规则'),
    matcher: typeof input.matcher === 'string' ? input.matcher : '',
    complexity: input.complexity === 'simple' || input.complexity === 'hard' ? input.complexity : 'normal',
    preferredModelStrategy: input.preferredModelStrategy === 'fast' || input.preferredModelStrategy === 'quality'
      ? input.preferredModelStrategy
      : 'balanced',
    targetAgentId: text(input.targetAgentId, 'main'),
    notes: text(input.notes) || undefined,
    enabled: input.enabled !== false,
    createdAt: time(input.createdAt ?? now),
    updatedAt: time(input.updatedAt ?? now),
  };
}

function normalizeReport(input: Partial<WorkbenchReport>): WorkbenchReport {
  return {
    id: text(input.id) || randomUUID(),
    projectId: text(input.projectId),
    title: text(input.title, '运行报告'),
    summary: typeof input.summary === 'string' ? input.summary : '',
    status: input.status === 'final' ? 'final' : 'draft',
    runId: text(input.runId) || undefined,
    taskId: text(input.taskId) || undefined,
    agentId: text(input.agentId) || undefined,
    durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
    createdAt: time(input.createdAt),
  };
}

function computeNextRunAt(cadence: AlwaysOnTask['cadence'], from = Date.now()): number | undefined {
  if (cadence === 'manual') return undefined;
  const interval = cadence === 'hourly'
    ? 60 * 60 * 1000
    : cadence === 'daily'
      ? 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;
  return from + interval;
}

async function readSnapshotFile(): Promise<WorkbenchSnapshot> {
  try {
    const raw = await readFile(workbenchPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WorkbenchSnapshot>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects.map(normalizeProject) : [],
      memories: Array.isArray(parsed.memories) ? parsed.memories.map(normalizeMemory) : [],
      alwaysOnTasks: Array.isArray(parsed.alwaysOnTasks) ? parsed.alwaysOnTasks.map(normalizeTask) : [],
      routingRules: Array.isArray(parsed.routingRules) ? parsed.routingRules.map(normalizeRule) : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports.map(normalizeReport) : [],
    };
  } catch {
    return emptySnapshot;
  }
}

async function writeSnapshotFile(snapshot: WorkbenchSnapshot): Promise<void> {
  await mkdir(getOpenClawConfigDir(), { recursive: true });
  await writeFile(workbenchPath(), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return [item, ...items.filter((candidate) => candidate.id !== item.id)];
}

export async function listWorkbenchSnapshot(): Promise<WorkbenchSnapshot> {
  return readSnapshotFile();
}

export async function saveWorkbenchProject(input: Partial<WorkbenchProject>): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const existing = input.id ? snapshot.projects.find((item) => item.id === input.id) : undefined;
    const project = normalizeProject({ ...existing, ...input, updatedAt: Date.now() });
    const next = { ...snapshot, projects: upsert(snapshot.projects, project) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function deleteWorkbenchProject(id: string): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const next = {
      ...snapshot,
      projects: snapshot.projects.filter((item) => item.id !== id),
      memories: snapshot.memories.filter((item) => item.projectId !== id),
      alwaysOnTasks: snapshot.alwaysOnTasks.filter((item) => item.projectId !== id),
      reports: snapshot.reports.filter((item) => item.projectId !== id),
    };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function saveWorkbenchMemory(input: Partial<WorkbenchMemory>): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const existing = input.id ? snapshot.memories.find((item) => item.id === input.id) : undefined;
    const memory = normalizeMemory({ ...existing, ...input, updatedAt: Date.now() });
    const next = { ...snapshot, memories: upsert(snapshot.memories, memory) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function deleteWorkbenchMemory(id: string): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const next = { ...snapshot, memories: snapshot.memories.filter((item) => item.id !== id) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function saveWorkbenchTask(input: Partial<AlwaysOnTask>): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const existing = input.id ? snapshot.alwaysOnTasks.find((item) => item.id === input.id) : undefined;
    const task = normalizeTask({ ...existing, ...input, updatedAt: Date.now() });
    const next = { ...snapshot, alwaysOnTasks: upsert(snapshot.alwaysOnTasks, task) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function deleteWorkbenchTask(id: string): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const next = { ...snapshot, alwaysOnTasks: snapshot.alwaysOnTasks.filter((item) => item.id !== id) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function markWorkbenchTaskRun(input: { id: string; status: AlwaysOnTask['lastRunStatus']; sessionKey?: string; error?: string }): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const task = snapshot.alwaysOnTasks.find((item) => item.id === input.id);
    if (!task) return snapshot;
    const now = Date.now();
    const isFirstStateForRun = input.status === 'running' && task.lastRunStatus !== 'queued' && task.lastRunStatus !== 'running';
    const isTerminalFailure = input.status === 'failed';
    const nextTask = normalizeTask({
      ...task,
      lastRunAt: now,
      nextRunAt: computeNextRunAt(task.cadence, now),
      runCount: isFirstStateForRun ? task.runCount + 1 : task.runCount,
      lastRunStatus: input.status,
      lastRunSessionKey: input.sessionKey ?? task.lastRunSessionKey,
      lastRunError: input.status === 'failed' ? input.error || task.lastRunError : undefined,
      failureCount: isTerminalFailure ? task.failureCount + 1 : task.failureCount,
      updatedAt: now,
    });
    const next = { ...snapshot, alwaysOnTasks: upsert(snapshot.alwaysOnTasks, nextTask) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function saveWorkbenchRoutingRule(input: Partial<RoutingRule>): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const existing = input.id ? snapshot.routingRules.find((item) => item.id === input.id) : undefined;
    const rule = normalizeRule({ ...existing, ...input, updatedAt: Date.now() });
    const next = { ...snapshot, routingRules: upsert(snapshot.routingRules, rule) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function deleteWorkbenchRoutingRule(id: string): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const next = { ...snapshot, routingRules: snapshot.routingRules.filter((item) => item.id !== id) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function saveWorkbenchReport(input: Partial<WorkbenchReport>): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const report = normalizeReport(input);
    const next = { ...snapshot, reports: upsert(snapshot.reports, report).slice(0, 200) };
    await writeSnapshotFile(next);
    return next;
  });
}

export async function deleteWorkbenchReport(id: string): Promise<WorkbenchSnapshot> {
  return withConfigLock(async () => {
    const snapshot = await readSnapshotFile();
    const next = { ...snapshot, reports: snapshot.reports.filter((item) => item.id !== id) };
    await writeSnapshotFile(next);
    return next;
  });
}
