import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getOpenClawConfigDir } from './paths';
import { withConfigLock } from './config-mutex';

export interface WorkflowStep {
  id: string;
  agentId: string;
  title: string;
  prompt: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  executionMode: 'sequential' | 'parallel';
  steps: WorkflowStep[];
  updatedAt: number;
}

interface WorkflowDocument {
  workflows?: WorkflowDefinition[];
}

const WORKFLOWS_FILE = 'clawx-workflows.json';

function workflowsPath(): string {
  return join(getOpenClawConfigDir(), WORKFLOWS_FILE);
}

function normalizeStep(step: Partial<WorkflowStep>, index: number): WorkflowStep {
  return {
    id: typeof step.id === 'string' && step.id.trim() ? step.id : randomUUID(),
    agentId: typeof step.agentId === 'string' && step.agentId.trim() ? step.agentId.trim() : 'main',
    title: typeof step.title === 'string' && step.title.trim() ? step.title.trim() : `Step ${index + 1}`,
    prompt: typeof step.prompt === 'string' ? step.prompt.trim() : '',
  };
}

function normalizeWorkflow(workflow: Partial<WorkflowDefinition>): WorkflowDefinition {
  const steps = Array.isArray(workflow.steps)
    ? workflow.steps.map((step, index) => normalizeStep(step, index)).filter((step) => step.prompt || step.title)
    : [];
  return {
    id: typeof workflow.id === 'string' && workflow.id.trim() ? workflow.id : randomUUID(),
    name: typeof workflow.name === 'string' && workflow.name.trim() ? workflow.name.trim() : 'Untitled Workflow',
    description: typeof workflow.description === 'string' ? workflow.description.trim() : '',
    executionMode: workflow.executionMode === 'parallel' ? 'parallel' : 'sequential',
    steps: steps.length > 0 ? steps : [normalizeStep({ title: 'Plan', prompt: 'Break down the request and propose the next action.' }, 0)],
    updatedAt: typeof workflow.updatedAt === 'number' ? workflow.updatedAt : Date.now(),
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
    };
  } catch {
    return { workflows: [] };
  }
}

async function writeWorkflowsDocument(document: WorkflowDocument): Promise<void> {
  await writeFile(workflowsPath(), `${JSON.stringify({ workflows: document.workflows ?? [] }, null, 2)}\n`, 'utf-8');
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
    await writeWorkflowsDocument({ workflows: next });
    return next;
  });
}

export async function deleteWorkflow(id: string): Promise<WorkflowDefinition[]> {
  return withConfigLock(async () => {
    const document = await readWorkflowsDocument();
    const next = (document.workflows ?? []).filter((workflow) => workflow.id !== id);
    await writeWorkflowsDocument({ workflows: next });
    return next;
  });
}
