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
