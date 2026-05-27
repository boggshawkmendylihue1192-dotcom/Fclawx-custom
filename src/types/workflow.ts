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

export interface WorkflowsSnapshot {
  workflows: WorkflowDefinition[];
}
