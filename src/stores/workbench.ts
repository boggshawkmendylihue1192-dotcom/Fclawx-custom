import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type {
  AlwaysOnTask,
  RoutingRule,
  WorkbenchMemory,
  WorkbenchProject,
  WorkbenchReport,
  WorkbenchSnapshot,
} from '@/types/workbench';

const LEGACY_STORAGE_KEY = 'clawx:pilotdeck-workbench';

interface WorkbenchState extends WorkbenchSnapshot {
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  saveProject: (project: Partial<WorkbenchProject>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  saveMemory: (memory: Partial<WorkbenchMemory>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  saveAlwaysOnTask: (task: Partial<AlwaysOnTask>) => Promise<void>;
  markAlwaysOnTaskRun: (id: string, status: AlwaysOnTask['lastRunStatus'], sessionKey?: string, error?: string) => Promise<void>;
  deleteAlwaysOnTask: (id: string) => Promise<void>;
  saveRoutingRule: (rule: Partial<RoutingRule>) => Promise<void>;
  deleteRoutingRule: (id: string) => Promise<void>;
  saveReport: (report: Partial<WorkbenchReport>) => Promise<void>;
  deleteReport: (id: string) => Promise<void>;
}

const emptySnapshot: WorkbenchSnapshot = {
  projects: [],
  memories: [],
  alwaysOnTasks: [],
  routingRules: [],
  reports: [],
};

function applySnapshot(snapshot: Partial<WorkbenchSnapshot> | undefined): WorkbenchSnapshot {
  return {
    projects: Array.isArray(snapshot?.projects) ? snapshot.projects : [],
    memories: Array.isArray(snapshot?.memories) ? snapshot.memories : [],
    alwaysOnTasks: Array.isArray(snapshot?.alwaysOnTasks) ? snapshot.alwaysOnTasks : [],
    routingRules: Array.isArray(snapshot?.routingRules) ? snapshot.routingRules : [],
    reports: Array.isArray(snapshot?.reports) ? snapshot.reports : [],
  };
}

function readLegacySnapshot(): Partial<WorkbenchSnapshot> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Partial<WorkbenchSnapshot> : null;
  } catch {
    return null;
  }
}

async function migrateLegacySnapshot(snapshot: WorkbenchSnapshot): Promise<WorkbenchSnapshot> {
  const legacy = readLegacySnapshot();
  if (!legacy) return snapshot;
  if (snapshot.projects.length > 0 || snapshot.memories.length > 0 || snapshot.alwaysOnTasks.length > 0) {
    return snapshot;
  }

  let latest = snapshot;
  for (const project of legacy.projects ?? []) {
    latest = applySnapshot(await hostApiFetch<WorkbenchSnapshot>('/api/workbench/projects', {
      method: 'POST',
      body: JSON.stringify(project),
    }));
  }
  for (const memory of legacy.memories ?? []) {
    latest = applySnapshot(await hostApiFetch<WorkbenchSnapshot>('/api/workbench/memories', {
      method: 'POST',
      body: JSON.stringify(memory),
    }));
  }
  for (const task of legacy.alwaysOnTasks ?? []) {
    latest = applySnapshot(await hostApiFetch<WorkbenchSnapshot>('/api/workbench/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    }));
  }
  for (const rule of legacy.routingRules ?? []) {
    latest = applySnapshot(await hostApiFetch<WorkbenchSnapshot>('/api/workbench/routing-rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    }));
  }
  for (const report of legacy.reports ?? []) {
    latest = applySnapshot(await hostApiFetch<WorkbenchSnapshot>('/api/workbench/reports', {
      method: 'POST',
      body: JSON.stringify(report),
    }));
  }
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  return latest;
}

export function buildWorkbenchRuntimeContext(message: string, requestedAgentId?: string | null): {
  message: string;
  targetAgentId?: string | null;
  routeNote?: string;
} {
  const state = useWorkbenchStore.getState();
  const lowerMessage = message.toLowerCase();
  const matchingRoutes = state.routingRules.filter((rule) => {
    if (!rule.enabled) return false;
    const matcher = rule.matcher.trim().toLowerCase();
    if (!matcher) return true;
    return matcher.split(/[,，\s]+/).filter(Boolean).some((keyword) => lowerMessage.includes(keyword));
  });
  const route = matchingRoutes.sort((a, b) => {
    const complexityScore = { simple: 1, normal: 2, hard: 3 } as const;
    return complexityScore[b.complexity] - complexityScore[a.complexity];
  })[0];
  const targetAgentId = requestedAgentId || route?.targetAgentId || null;
  const project = state.projects.find((item) => {
    if (item.status !== 'active') return false;
    return targetAgentId ? item.agentId === targetAgentId : item.agentId === 'main';
  }) ?? state.projects.find((item) => item.status === 'active');

  const memories = project
    ? state.memories
      .filter((memory) => memory.projectId === project.id && memory.status === 'active')
      .slice(0, 8)
    : [];

  const contextLines = [
    project ? `工作台项目：${project.name}` : '',
    project?.workspace ? `工作区路径：${project.workspace}` : '',
    route ? `智能路由：${route.name} / ${route.preferredModelStrategy} / ${route.complexity}` : '',
    route?.notes ? `路由说明：${route.notes}` : '',
    route ? `模型策略：${route.preferredModelStrategy === 'fast' ? '优先快速响应' : route.preferredModelStrategy === 'quality' ? '优先高质量推理' : '速度与质量均衡'}` : '',
    memories.length > 0 ? '白盒记忆：' : '',
    ...memories.map((memory) => `- ${memory.title}: ${memory.content}`),
  ].filter(Boolean);

  if (contextLines.length === 0) {
    return { message, targetAgentId };
  }

  return {
    message: [
      '<workbench_context>',
      ...contextLines,
      '</workbench_context>',
      '',
      message,
    ].join('\n'),
    targetAgentId,
    routeNote: route?.name,
  };
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  ...emptySnapshot,
  hydrated: false,
  loading: false,
  error: null,

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const snapshot = applySnapshot(await hostApiFetch<WorkbenchSnapshot>('/api/workbench'));
      const migrated = await migrateLegacySnapshot(snapshot);
      set({ ...migrated, hydrated: true, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error), hydrated: true });
    }
  },

  saveProject: async (project) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>('/api/workbench/projects', {
      method: 'POST',
      body: JSON.stringify(project),
    });
    set(applySnapshot(snapshot));
  },

  deleteProject: async (id) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>(`/api/workbench/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    set(applySnapshot(snapshot));
  },

  saveMemory: async (memory) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>('/api/workbench/memories', {
      method: 'POST',
      body: JSON.stringify(memory),
    });
    set(applySnapshot(snapshot));
  },

  deleteMemory: async (id) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>(`/api/workbench/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    set(applySnapshot(snapshot));
  },

  saveAlwaysOnTask: async (task) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>('/api/workbench/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    });
    set(applySnapshot(snapshot));
  },

  markAlwaysOnTaskRun: async (id, status, sessionKey, error) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>(`/api/workbench/tasks/${encodeURIComponent(id)}/mark-run`, {
      method: 'POST',
      body: JSON.stringify({ status, sessionKey, error }),
    });
    set(applySnapshot(snapshot));
  },

  deleteAlwaysOnTask: async (id) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>(`/api/workbench/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    set(applySnapshot(snapshot));
  },

  saveRoutingRule: async (rule) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>('/api/workbench/routing-rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    });
    set(applySnapshot(snapshot));
  },

  deleteRoutingRule: async (id) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>(`/api/workbench/routing-rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    set(applySnapshot(snapshot));
  },

  saveReport: async (report) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>('/api/workbench/reports', {
      method: 'POST',
      body: JSON.stringify(report),
    });
    set(applySnapshot(snapshot));
  },

  deleteReport: async (id) => {
    const snapshot = await hostApiFetch<WorkbenchSnapshot>(`/api/workbench/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    set(applySnapshot(snapshot));
  },
}));
