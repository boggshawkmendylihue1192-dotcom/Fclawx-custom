import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { KnowledgeItem, KnowledgeSnapshot } from '@/types/knowledge';

interface KnowledgeState extends KnowledgeSnapshot {
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  saveItem: (item: Partial<KnowledgeItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
}

function applySnapshot(snapshot: Partial<KnowledgeSnapshot> | undefined): KnowledgeSnapshot {
  return {
    items: Array.isArray(snapshot?.items) ? snapshot.items : [],
  };
}

export function selectKnowledgeForWorkflow(input: {
  workflowId?: string;
  agentIds?: string[];
  projectId?: string;
  text?: string;
  limit?: number;
}): KnowledgeItem[] {
  const state = useKnowledgeStore.getState();
  const agentIds = new Set(input.agentIds ?? []);
  const keywords = (input.text ?? '')
    .toLowerCase()
    .split(/[\s,，。；;:：/\\|()[\]{}'"`]+/)
    .filter((keyword) => keyword.length >= 2);

  return state.items
    .filter((item) => {
      if (item.status !== 'active') return false;
      if (item.scope === 'global') return true;
      if (item.scope === 'workflow') return !!input.workflowId && item.workflowId === input.workflowId;
      if (item.scope === 'agent') return !!item.agentId && agentIds.has(item.agentId);
      if (item.scope === 'project') return !!input.projectId && item.projectId === input.projectId;
      return false;
    })
    .map((item) => {
      const haystack = `${item.title}\n${item.content}\n${item.tags.join(' ')}`.toLowerCase();
      const keywordScore = keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
      const scopeScore = item.scope === 'workflow' ? 5 : item.scope === 'agent' ? 4 : item.scope === 'project' ? 3 : 2;
      const confidenceScore = item.confidence === 'high' ? 3 : item.confidence === 'medium' ? 2 : 1;
      return { item, score: keywordScore + scopeScore + confidenceScore };
    })
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .slice(0, input.limit ?? 8)
    .map((entry) => entry.item);
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  items: [],
  hydrated: false,
  loading: false,
  error: null,

  hydrate: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const snapshot = applySnapshot(await hostApiFetch<KnowledgeSnapshot>('/api/knowledge'));
      set({ ...snapshot, hydrated: true, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error), hydrated: true });
    }
  },

  saveItem: async (item) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<KnowledgeSnapshot>('/api/knowledge/items', {
        method: 'POST',
        body: JSON.stringify(item),
      });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteItem: async (id) => {
    set({ error: null });
    try {
      const snapshot = await hostApiFetch<KnowledgeSnapshot>(`/api/knowledge/items/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      set(applySnapshot(snapshot));
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
}));
