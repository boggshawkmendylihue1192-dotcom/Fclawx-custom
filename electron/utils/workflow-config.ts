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
  roleTemplateId?: string;
  dependsOn?: string[];
  contextMode?: 'isolated' | 'fork';
  fallbackAgentId?: string;
  retryCount?: number;
}

export interface WorkflowRoleTemplate {
  id: string;
  name: string;
  description: string;
  instructions: string;
  builtIn?: boolean;
  updatedAt: number;
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
  roleTemplates?: WorkflowRoleTemplate[];
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

const BUILT_IN_ROLE_TEMPLATES: WorkflowRoleTemplate[] = [
  {
    id: 'requirements-analyst',
    name: '需求分析员',
    description: '澄清目标、边界、风险和验收标准。',
    instructions: '你负责需求分析。先复述目标，列出不应影响的既有功能，再给出可执行的拆解和验收标准。不要直接改代码。',
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'code-searcher',
    name: '代码检索员',
    description: '定位相关文件、接口和现有实现。',
    instructions: '你负责代码检索。优先使用现有项目结构和已有模式，输出相关文件、关键函数、调用关系和可能影响范围。',
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'implementation-engineer',
    name: '实现工程师',
    description: '按现有架构完成具体实现。',
    instructions: '你负责实现。保持改动小而稳，遵循项目已有模式，不重写无关逻辑。完成后说明改了什么和为什么。',
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'review-engineer',
    name: '代码审查员',
    description: '检查回归风险、缺失测试和边界问题。',
    instructions: '你负责审查。优先指出 bug、回归风险、权限/配置问题和测试缺口。不要粉饰问题，按严重程度排序。',
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'test-release-engineer',
    name: '测试发布员',
    description: '运行验证、整理结果、准备发布。',
    instructions: '你负责测试和发布检查。确认类型检查、构建、安装包和版本号状态，输出通过项、失败项和发布阻塞点。',
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'summarizer',
    name: '总结员',
    description: '合并多智能体结果并给出最终结论。',
    instructions: '你负责总结。合并各步骤结果，去重、处理冲突，只保留用户需要知道的结论、改动、验证和后续建议。',
    builtIn: true,
    updatedAt: 0,
  },
];

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
  const roleTemplateId = typeof step.roleTemplateId === 'string' && step.roleTemplateId.trim()
    ? step.roleTemplateId.trim()
    : undefined;
  return {
    id: typeof step.id === 'string' && step.id.trim() ? step.id : randomUUID(),
    agentId: typeof step.agentId === 'string' && step.agentId.trim() ? step.agentId.trim() : 'main',
    title: typeof step.title === 'string' && step.title.trim() ? step.title.trim() : `步骤 ${index + 1}`,
    prompt: typeof step.prompt === 'string' ? step.prompt.trim() : '',
    roleTemplateId,
    dependsOn: normalizeStringList(step.dependsOn),
    contextMode: normalizeContextMode(step.contextMode),
    fallbackAgentId,
    retryCount: normalizeOptionalPositiveInteger(step.retryCount, 5) ?? 0,
  };
}

function normalizeRoleTemplate(role: Partial<WorkflowRoleTemplate>): WorkflowRoleTemplate {
  return {
    id: typeof role.id === 'string' && role.id.trim() ? role.id.trim() : randomUUID(),
    name: typeof role.name === 'string' && role.name.trim() ? role.name.trim() : '未命名职责',
    description: typeof role.description === 'string' ? role.description.trim() : '',
    instructions: typeof role.instructions === 'string' ? role.instructions.trim() : '',
    builtIn: role.builtIn === true,
    updatedAt: typeof role.updatedAt === 'number' ? role.updatedAt : Date.now(),
  };
}

function mergeRoleTemplates(customRoles: Partial<WorkflowRoleTemplate>[] | undefined): WorkflowRoleTemplate[] {
  const byId = new Map<string, WorkflowRoleTemplate>();
  for (const role of BUILT_IN_ROLE_TEMPLATES) byId.set(role.id, role);
  for (const role of Array.isArray(customRoles) ? customRoles : []) {
    const normalized = normalizeRoleTemplate({ ...role, builtIn: false });
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()];
}

function customRoleTemplates(roles: WorkflowRoleTemplate[] | undefined): WorkflowRoleTemplate[] {
  return (roles ?? []).filter((role) => !BUILT_IN_ROLE_TEMPLATES.some((builtIn) => builtIn.id === role.id));
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
      roleTemplates: mergeRoleTemplates(parsed.roleTemplates),
      runs: Array.isArray(parsed.runs)
        ? parsed.runs.map(normalizeRun).slice(0, 100)
        : [],
    };
  } catch {
    return { workflows: [], roleTemplates: mergeRoleTemplates([]), runs: [] };
  }
}

async function writeWorkflowsDocument(document: WorkflowDocument): Promise<void> {
  await writeFile(workflowsPath(), `${JSON.stringify({
    workflows: document.workflows ?? [],
    roleTemplates: customRoleTemplates(document.roleTemplates),
    runs: document.runs ?? [],
  }, null, 2)}\n`, 'utf-8');
}

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  const document = await readWorkflowsDocument();
  return document.workflows ?? [];
}

export async function listWorkflowRoleTemplates(): Promise<WorkflowRoleTemplate[]> {
  const document = await readWorkflowsDocument();
  return document.roleTemplates ?? mergeRoleTemplates([]);
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
    await writeWorkflowsDocument({ workflows: next, roleTemplates: document.roleTemplates ?? [], runs: document.runs ?? [] });
    return next;
  });
}

export async function deleteWorkflow(id: string): Promise<WorkflowDefinition[]> {
  return withConfigLock(async () => {
    const document = await readWorkflowsDocument();
    const next = (document.workflows ?? []).filter((workflow) => workflow.id !== id);
    await writeWorkflowsDocument({ workflows: next, roleTemplates: document.roleTemplates ?? [], runs: document.runs ?? [] });
    return next;
  });
}

export async function saveWorkflowRoleTemplate(input: Partial<WorkflowRoleTemplate>): Promise<WorkflowRoleTemplate[]> {
  return withConfigLock(async () => {
    const document = await readWorkflowsDocument();
    const roles = document.roleTemplates ?? mergeRoleTemplates([]);
    const role = normalizeRoleTemplate({ ...input, builtIn: false, updatedAt: Date.now() });
    if (!role.instructions.trim()) throw new Error('Role instructions are required');
    const next = [role, ...roles.filter((candidate) => candidate.id !== role.id)];
    await writeWorkflowsDocument({ workflows: document.workflows ?? [], roleTemplates: next, runs: document.runs ?? [] });
    return mergeRoleTemplates(customRoleTemplates(next));
  });
}

export async function deleteWorkflowRoleTemplate(id: string): Promise<WorkflowRoleTemplate[]> {
  return withConfigLock(async () => {
    if (BUILT_IN_ROLE_TEMPLATES.some((role) => role.id === id)) {
      return listWorkflowRoleTemplates();
    }
    const document = await readWorkflowsDocument();
    const next = (document.roleTemplates ?? []).filter((role) => role.id !== id);
    await writeWorkflowsDocument({ workflows: document.workflows ?? [], roleTemplates: next, runs: document.runs ?? [] });
    return mergeRoleTemplates(customRoleTemplates(next));
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
    await writeWorkflowsDocument({ workflows: document.workflows ?? [], roleTemplates: document.roleTemplates ?? [], runs: next });
    return next;
  });
}

export async function deleteWorkflowRun(id: string): Promise<WorkflowRunRecord[]> {
  return withConfigLock(async () => {
    const document = await readWorkflowsDocument();
    const next = (document.runs ?? []).filter((run) => run.id !== id);
    await writeWorkflowsDocument({ workflows: document.workflows ?? [], roleTemplates: document.roleTemplates ?? [], runs: next });
    return next;
  });
}
