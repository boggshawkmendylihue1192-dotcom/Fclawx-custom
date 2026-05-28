export interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  templateId?: string;
  toolPermissions?: AgentToolPermissions;
  delegationConfig?: AgentDelegationConfig;
  isDefault: boolean;
  modelDisplay: string;
  modelRef?: string | null;
  overrideModelRef?: string | null;
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

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef?: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}
