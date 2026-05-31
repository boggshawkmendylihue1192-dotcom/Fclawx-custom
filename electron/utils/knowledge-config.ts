import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { withConfigLock } from './config-mutex';
import { getOpenClawConfigDir } from './paths';

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

interface KnowledgeDocument {
  items?: KnowledgeItem[];
}

const KNOWLEDGE_FILE = 'clawx-knowledge.json';

function knowledgePath(): string {
  return join(getOpenClawConfigDir(), KNOWLEDGE_FILE);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function time(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    .map((tag) => tag.trim());
}

function normalizeScope(value: unknown): KnowledgeScope {
  return value === 'project' || value === 'agent' || value === 'workflow' ? value : 'global';
}

function normalizeKnowledgeItem(input: Partial<KnowledgeItem>): KnowledgeItem {
  const now = Date.now();
  return {
    id: text(input.id) || randomUUID(),
    title: text(input.title, '未命名知识'),
    content: typeof input.content === 'string' ? input.content : '',
    tags: normalizeTags(input.tags),
    scope: normalizeScope(input.scope),
    projectId: text(input.projectId) || undefined,
    agentId: text(input.agentId) || undefined,
    workflowId: text(input.workflowId) || undefined,
    source: text(input.source, 'manual'),
    confidence: input.confidence === 'low' || input.confidence === 'high' ? input.confidence : 'medium',
    status: input.status === 'archived' ? 'archived' : 'active',
    createdAt: time(input.createdAt ?? now),
    updatedAt: time(input.updatedAt ?? now),
  };
}

async function readKnowledgeDocument(): Promise<KnowledgeDocument> {
  try {
    const raw = await readFile(knowledgePath(), 'utf-8');
    const parsed = JSON.parse(raw) as KnowledgeDocument;
    return {
      items: Array.isArray(parsed.items) ? parsed.items.map(normalizeKnowledgeItem) : [],
    };
  } catch {
    return { items: [] };
  }
}

async function writeKnowledgeDocument(document: KnowledgeDocument): Promise<void> {
  await mkdir(getOpenClawConfigDir(), { recursive: true });
  await writeFile(knowledgePath(), `${JSON.stringify({ items: document.items ?? [] }, null, 2)}\n`, 'utf-8');
}

export async function listKnowledgeItems(): Promise<KnowledgeItem[]> {
  const document = await readKnowledgeDocument();
  return document.items ?? [];
}

export async function saveKnowledgeItem(input: Partial<KnowledgeItem>): Promise<KnowledgeItem[]> {
  return withConfigLock(async () => {
    const document = await readKnowledgeDocument();
    const items = document.items ?? [];
    const existing = input.id ? items.find((item) => item.id === input.id) : undefined;
    const item = normalizeKnowledgeItem({ ...existing, ...input, updatedAt: Date.now() });
    const next = [item, ...items.filter((candidate) => candidate.id !== item.id)];
    await writeKnowledgeDocument({ items: next });
    return next;
  });
}

export async function deleteKnowledgeItem(id: string): Promise<KnowledgeItem[]> {
  return withConfigLock(async () => {
    const document = await readKnowledgeDocument();
    const next = (document.items ?? []).filter((item) => item.id !== id);
    await writeKnowledgeDocument({ items: next });
    return next;
  });
}
