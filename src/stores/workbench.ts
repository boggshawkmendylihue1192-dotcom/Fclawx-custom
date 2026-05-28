import { create } from 'zustand';
import type {
  AlwaysOnTask,
  RoutingRule,
  WorkbenchMemory,
  WorkbenchProject,
  WorkbenchReport,
  WorkbenchSnapshot,
} from '@/types/workbench';

const STORAGE_KEY = 'clawx:pilotdeck-workbench';

interface WorkbenchState extends WorkbenchSnapshot {
  hydrated: boolean;
  hydrate: () => void;
  saveProject: (project: Partial<WorkbenchProject>) => void;
  deleteProject: (id: string) => void;
  saveMemory: (memory: Partial<WorkbenchMemory>) => void;
  deleteMemory: (id: string) => void;
  saveAlwaysOnTask: (task: Partial<AlwaysOnTask>) => void;
  deleteAlwaysOnTask: (id: string) => void;
  saveRoutingRule: (rule: Partial<RoutingRule>) => void;
  deleteRoutingRule: (id: string) => void;
  saveReport: (report: Partial<WorkbenchReport>) => void;
  deleteReport: (id: string) => void;
}

const emptySnapshot: WorkbenchSnapshot = {
  projects: [],
  memories: [],
  alwaysOnTasks: [],
  routingRules: [],
  reports: [],
};

function now() {
  return Date.now();
}

function readSnapshot(): WorkbenchSnapshot {
  if (typeof window === 'undefined') return emptySnapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySnapshot;
    const parsed = JSON.parse(raw) as Partial<WorkbenchSnapshot>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      alwaysOnTasks: Array.isArray(parsed.alwaysOnTasks) ? parsed.alwaysOnTasks : [],
      routingRules: Array.isArray(parsed.routingRules) ? parsed.routingRules : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    };
  } catch {
    return emptySnapshot;
  }
}

function writeSnapshot(snapshot: WorkbenchSnapshot): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function upsertById<T extends { id: string; createdAt?: number; updatedAt?: number }>(items: T[], item: T): T[] {
  const next = items.some((candidate) => candidate.id === item.id)
    ? items.map((candidate) => candidate.id === item.id ? item : candidate)
    : [item, ...items];
  return next;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  ...emptySnapshot,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ ...readSnapshot(), hydrated: true });
  },

  saveProject: (project) => {
    const timestamp = now();
    const current = get();
    const existing = project.id ? current.projects.find((candidate) => candidate.id === project.id) : undefined;
    const nextProject: WorkbenchProject = {
      id: project.id || crypto.randomUUID(),
      name: project.name?.trim() || existing?.name || '新工作区',
      description: project.description ?? existing?.description ?? '',
      agentId: project.agentId || existing?.agentId || 'main',
      workspace: project.workspace ?? existing?.workspace ?? '',
      status: project.status || existing?.status || 'active',
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const snapshot = { ...current, projects: upsertById(current.projects, nextProject) };
    writeSnapshot(snapshot);
    set({ projects: snapshot.projects });
  },

  deleteProject: (id) => {
    const current = get();
    const snapshot = {
      ...current,
      projects: current.projects.filter((item) => item.id !== id),
      memories: current.memories.filter((item) => item.projectId !== id),
      alwaysOnTasks: current.alwaysOnTasks.filter((item) => item.projectId !== id),
      reports: current.reports.filter((item) => item.projectId !== id),
    };
    writeSnapshot(snapshot);
    set({
      projects: snapshot.projects,
      memories: snapshot.memories,
      alwaysOnTasks: snapshot.alwaysOnTasks,
      reports: snapshot.reports,
    });
  },

  saveMemory: (memory) => {
    const timestamp = now();
    const current = get();
    const existing = memory.id ? current.memories.find((candidate) => candidate.id === memory.id) : undefined;
    const nextMemory: WorkbenchMemory = {
      id: memory.id || crypto.randomUUID(),
      projectId: memory.projectId || existing?.projectId || current.projects[0]?.id || '',
      title: memory.title?.trim() || existing?.title || '记忆条目',
      content: memory.content ?? existing?.content ?? '',
      source: memory.source ?? existing?.source ?? 'manual',
      confidence: memory.confidence || existing?.confidence || 'medium',
      status: memory.status || existing?.status || 'active',
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const snapshot = { ...current, memories: upsertById(current.memories, nextMemory) };
    writeSnapshot(snapshot);
    set({ memories: snapshot.memories });
  },

  deleteMemory: (id) => {
    const current = get();
    const memories = current.memories.filter((item) => item.id !== id);
    writeSnapshot({ ...current, memories });
    set({ memories });
  },

  saveAlwaysOnTask: (task) => {
    const timestamp = now();
    const current = get();
    const existing = task.id ? current.alwaysOnTasks.find((candidate) => candidate.id === task.id) : undefined;
    const nextTask: AlwaysOnTask = {
      id: task.id || crypto.randomUUID(),
      projectId: task.projectId || existing?.projectId || current.projects[0]?.id || '',
      title: task.title?.trim() || existing?.title || '后台任务',
      cadence: task.cadence || existing?.cadence || 'manual',
      objective: task.objective ?? existing?.objective ?? '',
      status: task.status || existing?.status || 'active',
      lastRunAt: task.lastRunAt ?? existing?.lastRunAt,
      nextRunHint: task.nextRunHint ?? existing?.nextRunHint,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const snapshot = { ...current, alwaysOnTasks: upsertById(current.alwaysOnTasks, nextTask) };
    writeSnapshot(snapshot);
    set({ alwaysOnTasks: snapshot.alwaysOnTasks });
  },

  deleteAlwaysOnTask: (id) => {
    const current = get();
    const alwaysOnTasks = current.alwaysOnTasks.filter((item) => item.id !== id);
    writeSnapshot({ ...current, alwaysOnTasks });
    set({ alwaysOnTasks });
  },

  saveRoutingRule: (rule) => {
    const timestamp = now();
    const current = get();
    const existing = rule.id ? current.routingRules.find((candidate) => candidate.id === rule.id) : undefined;
    const nextRule: RoutingRule = {
      id: rule.id || crypto.randomUUID(),
      name: rule.name?.trim() || existing?.name || '路由规则',
      matcher: rule.matcher ?? existing?.matcher ?? '',
      complexity: rule.complexity || existing?.complexity || 'normal',
      preferredModelStrategy: rule.preferredModelStrategy || existing?.preferredModelStrategy || 'balanced',
      targetAgentId: rule.targetAgentId || existing?.targetAgentId || 'main',
      enabled: rule.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    const snapshot = { ...current, routingRules: upsertById(current.routingRules, nextRule) };
    writeSnapshot(snapshot);
    set({ routingRules: snapshot.routingRules });
  },

  deleteRoutingRule: (id) => {
    const current = get();
    const routingRules = current.routingRules.filter((item) => item.id !== id);
    writeSnapshot({ ...current, routingRules });
    set({ routingRules });
  },

  saveReport: (report) => {
    const timestamp = now();
    const current = get();
    const existing = report.id ? current.reports.find((candidate) => candidate.id === report.id) : undefined;
    const nextReport: WorkbenchReport = {
      id: report.id || crypto.randomUUID(),
      projectId: report.projectId || existing?.projectId || current.projects[0]?.id || '',
      title: report.title?.trim() || existing?.title || '运行报告',
      summary: report.summary ?? existing?.summary ?? '',
      status: report.status || existing?.status || 'draft',
      createdAt: existing?.createdAt || timestamp,
    };
    const snapshot = { ...current, reports: upsertById(current.reports, nextReport) };
    writeSnapshot(snapshot);
    set({ reports: snapshot.reports });
  },

  deleteReport: (id) => {
    const current = get();
    const reports = current.reports.filter((item) => item.id !== id);
    writeSnapshot({ ...current, reports });
    set({ reports });
  },
}));
