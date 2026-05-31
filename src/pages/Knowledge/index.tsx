import { useEffect, useMemo, useState } from 'react';
import { Archive, Bot, FolderKanban, Globe2, Plus, RefreshCw, Save, Search, Trash2, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAgentsStore } from '@/stores/agents';
import { useKnowledgeStore } from '@/stores/knowledge';
import { useWorkbenchStore } from '@/stores/workbench';
import { useWorkflowsStore } from '@/stores/workflows';
import { cn } from '@/lib/utils';
import type { KnowledgeItem, KnowledgeScope } from '@/types/knowledge';

const inputClasses = 'h-[42px] rounded-xl text-sm bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const selectClasses = 'h-[42px] w-full rounded-xl text-sm bg-transparent border border-black/10 dark:border-white/10 px-3 text-foreground';

function emptyDraft(): Partial<KnowledgeItem> {
  return {
    title: '',
    content: '',
    tags: [],
    scope: 'global',
    source: 'manual',
    confidence: 'medium',
    status: 'active',
  };
}

function scopeIcon(scope: KnowledgeScope) {
  if (scope === 'agent') return <Bot className="h-4 w-4" />;
  if (scope === 'workflow') return <Workflow className="h-4 w-4" />;
  if (scope === 'project') return <FolderKanban className="h-4 w-4" />;
  return <Globe2 className="h-4 w-4" />;
}

function formatTime(value: number) {
  return new Date(value).toLocaleString();
}

export function Knowledge() {
  const { items, loading, error, hydrate, saveItem, deleteItem } = useKnowledgeStore();
  const { agents, fetchAgents } = useAgentsStore();
  const { projects, hydrate: hydrateWorkbench } = useWorkbenchStore();
  const { workflows, fetchWorkflows } = useWorkflowsStore();
  const [draft, setDraft] = useState<Partial<KnowledgeItem>>(emptyDraft);
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | KnowledgeScope>('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([hydrate(), fetchAgents(), hydrateWorkbench(), fetchWorkflows()]);
  }, [fetchAgents, fetchWorkflows, hydrate, hydrateWorkbench]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (scopeFilter !== 'all' && item.scope !== scopeFilter) return false;
      if (!q) return true;
      return `${item.title}\n${item.content}\n${item.tags.join(' ')}`.toLowerCase().includes(q);
    });
  }, [items, query, scopeFilter]);

  const saveDraft = async () => {
    if (!draft.title?.trim() || !draft.content?.trim()) {
      toast.error('请填写标题和内容');
      return;
    }
    if (draft.scope === 'project' && !draft.projectId) {
      toast.error('请选择绑定工作区');
      return;
    }
    if (draft.scope === 'agent' && !draft.agentId) {
      toast.error('请选择绑定智能体');
      return;
    }
    if (draft.scope === 'workflow' && !draft.workflowId) {
      toast.error('请选择绑定工作流');
      return;
    }
    setSaving(true);
    try {
      await saveItem({
        ...draft,
        tags: Array.isArray(draft.tags) ? draft.tags : [],
        projectId: draft.scope === 'project' ? draft.projectId : undefined,
        agentId: draft.scope === 'agent' ? draft.agentId : undefined,
        workflowId: draft.scope === 'workflow' ? draft.workflowId : undefined,
      });
      setDraft(emptyDraft());
      toast.success('知识已保存');
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="knowledge-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-7xl mx-auto flex flex-col h-full p-10 pt-14">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">知识库</h1>
            <p className="text-subtitle text-foreground/70 font-medium">
              独立管理项目规则、历史踩坑、发布流程和智能体长期上下文，工作流运行时可自动注入。
            </p>
          </div>
          <Button variant="outline" onClick={() => void hydrate()} className="h-9 rounded-full px-4">
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            刷新
          </Button>
        </div>

        {error && <div className="mb-4 rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[430px_1fr]">
          <Card className="min-h-0 overflow-y-auto rounded-2xl border-black/10 bg-transparent dark:border-white/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Plus className="h-5 w-5" />
                {draft.id ? '编辑知识' : '新增知识'}
              </CardTitle>
              <CardDescription>知识库是独立模块，不会改写智能体配置；只有工作流或后续显式启用时才会读取。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>标题</Label>
                <Input value={draft.title ?? ''} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={inputClasses} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>作用范围</Label>
                  <select value={draft.scope ?? 'global'} onChange={(event) => setDraft({ ...draft, scope: event.target.value as KnowledgeScope })} className={selectClasses}>
                    <option value="global">全局</option>
                    <option value="project">工作区/项目</option>
                    <option value="agent">智能体</option>
                    <option value="workflow">工作流</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>可信度</Label>
                  <select value={draft.confidence ?? 'medium'} onChange={(event) => setDraft({ ...draft, confidence: event.target.value as KnowledgeItem['confidence'] })} className={selectClasses}>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                  </select>
                </div>
              </div>

              {draft.scope === 'project' && (
                <div className="space-y-2">
                  <Label>绑定工作区</Label>
                  <select value={draft.projectId ?? ''} onChange={(event) => setDraft({ ...draft, projectId: event.target.value || undefined })} className={selectClasses}>
                    <option value="">不绑定</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </div>
              )}
              {draft.scope === 'agent' && (
                <div className="space-y-2">
                  <Label>绑定智能体</Label>
                  <select value={draft.agentId ?? ''} onChange={(event) => setDraft({ ...draft, agentId: event.target.value || undefined })} className={selectClasses}>
                    <option value="">不绑定</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                </div>
              )}
              {draft.scope === 'workflow' && (
                <div className="space-y-2">
                  <Label>绑定工作流</Label>
                  <select value={draft.workflowId ?? ''} onChange={(event) => setDraft({ ...draft, workflowId: event.target.value || undefined })} className={selectClasses}>
                    <option value="">不绑定</option>
                    {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <Label>标签</Label>
                <Input
                  value={(draft.tags ?? []).join(', ')}
                  onChange={(event) => setDraft({ ...draft, tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })}
                  className={inputClasses}
                  placeholder="发布规则, OpenClaw, 搜索工具"
                />
              </div>
              <div className="space-y-2">
                <Label>内容</Label>
                <textarea
                  value={draft.content ?? ''}
                  onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                  className="min-h-[180px] w-full rounded-xl border border-black/10 bg-transparent p-3 text-sm text-foreground resize-y dark:border-white/10"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" onClick={() => setDraft(emptyDraft())} className="h-9 rounded-full px-4">清空</Button>
                <Button disabled={saving} onClick={() => void saveDraft()} className="h-9 rounded-full px-4">
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {!saving && '保存知识'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="min-h-0 overflow-y-auto pr-2 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} className={cn(inputClasses, 'pl-9')} placeholder="搜索知识标题、内容或标签" />
              </div>
              <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as typeof scopeFilter)} className={cn(selectClasses, 'md:w-[180px]')}>
                <option value="all">全部范围</option>
                <option value="global">全局</option>
                <option value="project">工作区/项目</option>
                <option value="agent">智能体</option>
                <option value="workflow">工作流</option>
              </select>
            </div>

            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/10 p-8 text-center text-sm text-muted-foreground dark:border-white/10">
                暂无知识条目。
              </div>
            ) : filteredItems.map((item) => (
              <div key={item.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setDraft(item)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {scopeIcon(item.scope)}
                      <span className="truncate">{item.title}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.content}</p>
                  </button>
                  <Button variant="ghost" size="icon" onClick={() => void deleteItem(item.id)} className="h-8 w-8 rounded-lg text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-1 dark:bg-white/10">
                    <Archive className="h-3 w-3" />
                    {item.scope}
                  </span>
                  <span>{item.confidence}</span>
                  <span>{formatTime(item.updatedAt)}</span>
                  {item.tags.map((tag) => <span key={tag} className="rounded-full bg-primary/10 px-2 py-1 text-primary">{tag}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Knowledge;
