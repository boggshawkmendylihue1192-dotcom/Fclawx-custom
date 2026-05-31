export type KnowledgeScope = 'global' | 'project' | 'agent' | 'workflow';

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  scope: KnowledgeScope;
  projectId?: string;
  agentId?: string;
  workflowId?: string;
  source: string;
  confidence: 'low' | 'medium' | 'high';
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeSnapshot {
  items: KnowledgeItem[];
}
