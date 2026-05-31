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

export interface WorkflowsSnapshot {
  workflows: WorkflowDefinition[];
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
