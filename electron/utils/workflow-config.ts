import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { withConfigLock } from './config-mutex';
import { getOpenClawConfigDir } from './paths';

export interface WorkflowStep {
  id: string;
  agentId: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
  contextMode?: 'isolated' | 'fork';
  fallbackAgentId?: string;
  retryCount?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  executionMode: 'sequential' | 'parallel' | 'dag';
  teamTemplate?: string;
  reviewerAgentId?: string;
  maxRuntimeMinutes?: number;
  maxTokenBudget?: number;
  assignmentStrategy?: 'manual' | 'auto';
  modelStrategy?: 'quality' | 'balanced' | 'fast';
  steps: WorkflowStep[];
  updatedAt: number;
}

interface WorkflowDocument {
  workflows?: WorkflowDefinition[];
  runs?: WorkflowRunRecord[];
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  executionMode: WorkflowDefinition['executionMode'];
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  sessionKey?: string;
  stepCount: number;
  agentIds: string[];
  error?: string;
}

const WORKFLOWS_FILE = 'clawx-workflows.json';

function workflowsPath(): string {
  return join(getOpenClawConfigDir(), WORKFLOWS_FILE);
}

function normalizeExecutionMode(value: unknown): WorkflowDefinition['executionMode'] {
  return value === 'parallel' || value === 'dag' ? value : 'sequential';
}

function normalizeContextMode(value: unknown): WorkflowStep['contextMode'] {
  return value === 'fork' ? 'fork' : 'isolated';
}

function normalizeAssignmentStrategy(value: unknown): WorkflowDefinition['assignmentStrategy'] {
  return value === 'auto' ? 'auto' : 'manual';
}

function normalizeModelStrategy(value: unknown): WorkflowDefinition['modelStrategy'] {
  return value === 'quality' || value === 'fast' ? value : 'balanced';
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function normalizeOptionalPositiveInteger(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  if (normalized <= 0) return undefined;
  return Math.min(normalized, max);
}

function normalizeStep(step: Partial<WorkflowStep>, index: number): WorkflowStep {
  const fallbackAgentId = typeof step.fallbackAgentId === 'string' && step.fallbackAgentId.trim()
    ? step.fallbackAgentId.trim()
    : undefined;
  return {
    id: typeof step.id === 'string' && step.id.trim() ? step.id : randomUUID(),
    agentId: typeof step.agentId === 'string' && step.agentId.trim() ? step.agentId.trim() : 'main',
    title: typeof step.title === 'string' && step.title.trim() ? step.title.trim() : `步骤 ${index + 1}`,
    prompt: typeof step.prompt === 'string' ? step.prompt.trim() : '',
    dependsOn: normalizeStringList(step.dependsOn),
    contextMode: normalizeContextMode(step.contextMode),
    fallbackAgentId,
    retryCount: normalizeOptionalPositiveInteger(step.retryCount, 5) ?? 0,
  };
}

function normalizeWorkflow(workflow: Partial<WorkflowDefinition>): WorkflowDefinition {
  const steps = Array.isArray(workflow.steps)
    ? workflow.steps.map((step, index) => normalizeStep(step, index)).filter((step) => step.prompt || step.title)
    : [];
  return {
    id: typeof workflow.id === 'string' && workflow.id.trim() ? workflow.id : randomUUID(),
    name: typeof workflow.name === 'string' && workflow.name.trim() ? workflow.name.trim() : '未命名工作流',
    description: typeof workflow.description === 'string' ? workflow.description.trim() : '',
    executionMode: normalizeExecutionMode(workflow.executionMode),
    teamTemplate: typeof workflow.teamTemplate === 'string' ? workflow.teamTemplate.trim() : undefined,
    reviewerAgentId: typeof workflow.reviewerAgentId === 'string' && workflow.reviewerAgentId.trim() ? workflow.reviewerAgentId.trim() : undefined,
    maxRuntimeMinutes: normalizeOptionalPositiveInteger(workflow.maxRuntimeMinutes, 24 * 60),
    maxTokenBudget: normalizeOptionalPositiveInteger(workflow.maxTokenBudget, 5_000_000),
    assignmentStrategy: normalizeAssignmentStrategy(workflow.assignmentStrategy),
    modelStrategy: normalizeModelStrategy(workflow.modelStrategy),
    steps: steps.length > 0 ? steps : [normalizeStep({ title: '规划任务', prompt: '拆解请求，并提出下一步行动。' }, 0)],
    updatedAt: typeof workflow.updatedAt === 'number' ? workflow.updatedAt : Date.now(),
  };
}

function normalizeRun(run: Partial<WorkflowRunRecord>): WorkflowRunRecord {
  const startedAt = typeof run.startedAt === 'number' && Number.isFinite(run.startedAt) ? run.startedAt : Date.now();
  const finishedAt = typeof run.finishedAt === 'number' && Number.isFinite(run.finishedAt) ? run.finishedAt : undefined;
  return {
    id: typeof run.id === 'string' && run.id.trim() ? run.id.trim() : randomUUID(),
    workflowId: typeof run.workflowId === 'string' ? run.workflowId : '',
    workflowName: typeof run.workflowName === 'string' && run.workflowName.trim() ? run.workflowName.trim() : '未命名工作流',
    executionMode: normalizeExecutionMode(run.executionMode),
    status: run.status === 'failed' || run.status === 'running' ? run.status : 'completed',
    startedAt,
    finishedAt,
    durationMs: normalizeOptionalPositiveInteger(run.durationMs, 30 * 24 * 60 * 60 * 1000),
    sessionKey: typeof run.sessionKey === 'string' && run.sessionKey.trim() ? run.sessionKey.trim() : undefined,
    stepCount: normalizeOptionalPositiveInteger(run.stepCount, 10_000) ?? 0,
    agentIds: normalizeStringList(run.agentIds),
    error: typeof run.error === 'string' && run.error.trim() ? run.error.trim() : undefined,
  };
}

async function readWorkflowsDocument(): Promise<WorkflowDocument> {
  try {
    const raw = await readFile(workflowsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as WorkflowDocument;
    return {
      workflows: Array.isArray(parsed.workflows)
        ? parsed.workflows.map(normalizeWorkflow)
        : [],
      runs: Array.isArray(parsed.runs)
        ? parsed.runs.map(normalizeRun).slice(0, 100)
        : [],
    };
  } catch {
    return { workflows: [], runs: [] };
  }
}

async function writeWorkflowsDocument(document: WorkflowDocument): Promise<void> {
  await writeFile(workflowsPath(), `${JSON.stringify({ workflows: document.workflows ?? [], runs: document.runs ?? [] }, null, 2)}\n`, 'utf-8');
}

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  const document = await readWorkflowsDocument();
  return document.workflows ?? [];
}

export async function saveWorkflow(input: Partial<WorkflowDefinition>): Promise<WorkflowDefinition[]> {
  return withConfigLock(async () => {
    const document = await readWorkflowsDocument();
    const workflows = document.workflows ?? [];
    const workflow = normalizeWorkflow({ ...input, updatedAt: Date.now() });
    const index = workflows.findIndex((candidate) => candidate.id === workflow.id);
    const next = index >= 0
      ? workflows.map((candidate) => candidate.id === workflow.id ? workflow : candidate)
      : [workflow, ...workflows];
    await writeWorkflowsDocument({ workflows: next, runs: document.runs ?? [] });
    return next;
  });
}

export async function deleteWorkflow(id: string): Promise<WorkflowDefinition[]> {
  return withConfigLock(async () => {
    const document = await readWorkflowsDocument();
    const next = (document.workflows ?? []).filter((workflow) => workflow.id !== id);
    await writeWorkflowsDocument({ workflows: next, runs: document.runs ?? [] });
    return next;
  });
}

export async function listWorkflowRuns(): Promise<WorkflowRunRecord[]> {
  const document = await readWorkflowsDocument();
  return document.runs ?? [];
}

export async function saveWorkflowRun(input: Partial<WorkflowRunRecord>): Promise<WorkflowRunRecord[]> {
  return withConfigLock(async () => {
    const document = await readWorkflowsDocument();
    const runs = document.runs ?? [];
    const run = normalizeRun(input);
    const next = [run, ...runs.filter((candidate) => candidate.id !== run.id)].slice(0, 100);
    await writeWorkflowsDocument({ workflows: document.workflows ?? [], runs: next });
    return next;
  });
}

export async function deleteWorkflowRun(id: string): Promise<WorkflowRunRecord[]> {
  return withConfigLock(async () => {
    const document = await readWorkflowsDocument();
    const next = (document.runs ?? []).filter((run) => run.id !== id);
    await writeWorkflowsDocument({ workflows: document.workflows ?? [], runs: next });
    return next;
  });
}
