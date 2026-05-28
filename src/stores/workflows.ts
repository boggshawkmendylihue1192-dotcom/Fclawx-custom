import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { WorkflowDefinition, WorkflowRunRecord, WorkflowsSnapshot } from '@/types/workflow';

interface WorkflowsState {
  workflows: WorkflowDefinition[];
  runs: WorkflowRunRecord[];
  loading: boolean;
  error: string | null;
  fetchWorkflows: () => Promise<void>;
  saveWorkflow: (workflow: Partial<WorkflowDefinition>) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  saveRun: (run: Partial<WorkflowRunRecord>) => Promise<void>;
  deleteRun: (id: string) => Promise<void>;
}

function applySnapshot(snapshot: WorkflowsSnapshot | undefined) {
  return { workflows: snapshot?.workflows ?? [], runs: snapshot?.runs ?? [] };
}

export const useWorkflowsStore = create<WorkflowsState>((set) => ({
  workflows: [],
  runs: [],
  loading: false,
  error: null,

  fetchWorkflows: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await hostApiFetch<WorkflowsSnapshot & { success?: boolean }>('/api/workflows');
      set({ ...applySnapshot(snapshot), loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  saveWorkflow: async (workflow) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<WorkflowsSnapshot & { success?: boolean }>('/api/workflows', {
        method: 'POST',
        body: JSON.stringify(workflow),
      });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteWorkflow: async (id) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<WorkflowsSnapshot & { success?: boolean }>(`/api/workflows/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  saveRun: async (run) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<{ success?: boolean; runs?: WorkflowRunRecord[] }>('/api/workflows/runs', {
        method: 'POST',
        body: JSON.stringify(run),
      });
      set({ runs: snapshot.runs ?? [] });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteRun: async (id) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<{ success?: boolean; runs?: WorkflowRunRecord[] }>(`/api/workflows/runs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      set({ runs: snapshot.runs ?? [] });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
}));
