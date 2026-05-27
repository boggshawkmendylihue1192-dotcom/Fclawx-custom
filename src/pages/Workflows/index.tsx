import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Play, Plus, RefreshCw, Save, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useWorkflowsStore } from '@/stores/workflows';
import type { WorkflowDefinition, WorkflowStep } from '@/types/workflow';
import { cn } from '@/lib/utils';

const inputClasses = 'h-[44px] rounded-xl text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const selectClasses = 'h-[44px] w-full rounded-xl text-meta bg-transparent border border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground px-3';
const labelClasses = 'text-sm text-foreground/80 font-bold';

function createStep(agentId: string, index: number): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    agentId,
    title: index === 0 ? '规划任务' : `步骤 ${index + 1}`,
    prompt: index === 0 ? '拆解任务，确认需要完成的工作。' : '',
  };
}

function composeWorkflowPrompt(workflow: WorkflowDefinition, agentsById: Record<string, string>): string {
  const steps = workflow.steps.map((step, index) => {
    const agentName = agentsById[step.agentId] || step.agentId;
    return `${index + 1}. ${step.title}\nTarget agentId: ${step.agentId} (${agentName})\nTask:\n${step.prompt}`;
  }).join('\n\n');
  const executionGuidance = workflow.executionMode === 'parallel'
    ? '先用 sessions_spawn 启动所有彼此独立的步骤，每一步都必须使用对应的 exact target agentId。然后调用 sessions_yield 收集子任务结果，并综合输出。'
    : '按顺序执行步骤。任何分配给其他智能体的步骤，都必须用 sessions_spawn 并传入 exact target agentId；需要结果时调用 sessions_yield，然后继续下一步。';
  return [
    `执行这个多智能体工作流：${workflow.name}`,
    workflow.description ? `描述：${workflow.description}` : '',
    `执行模式：${workflow.executionMode}`,
    '',
    'Delegation protocol:',
    '- 委托给其他智能体时必须实际调用 sessions_spawn，不要只在文字里描述委托。',
    '- 始终把步骤目标作为 agentId 传入。',
    '- 尽量根据步骤标题生成简短的 taskName。',
    '- 子任务结果是证据；最终回答前要核对、整合这些结果。',
    `- ${executionGuidance}`,
    '',
    '工作流步骤：',
    steps,
  ].filter(Boolean).join('\n');
}

export function Workflows() {
  const navigate = useNavigate();
  const { workflows, loading, error, fetchWorkflows, saveWorkflow, deleteWorkflow } = useWorkflowsStore();
  const { agents, fetchAgents } = useAgentsStore();
  const sendMessage = useChatStore((state) => state.sendMessage);
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null);
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowDefinition | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetchWorkflows(), fetchAgents()]);
  }, [fetchAgents, fetchWorkflows]);

  const agentsById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const firstAgentId = agents[0]?.id || 'main';

  const handleNew = () => {
    setEditing({
      id: crypto.randomUUID(),
      name: '新工作流',
      description: '',
      executionMode: 'sequential',
      steps: [createStep(firstAgentId, 0), createStep(firstAgentId, 1)],
      updatedAt: Date.now(),
    });
  };

  const handleRun = async (workflow: WorkflowDefinition) => {
    setRunningId(workflow.id);
    try {
      navigate('/');
      await sendMessage(composeWorkflowPrompt(workflow, agentsById), undefined, workflow.steps[0]?.agentId || 'main');
      toast.success('工作流已启动');
    } catch (err) {
      toast.error(`启动工作流失败：${String(err)}`);
    } finally {
      setRunningId(null);
    }
  };

  if (loading && workflows.length === 0) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="workflows-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">工作流</h1>
            <p className="text-subtitle text-foreground/70 font-medium">编排可复用的多智能体任务流程。</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button variant="outline" onClick={() => void fetchWorkflows()} className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none">
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button onClick={handleNew} className="h-9 text-meta font-medium rounded-full px-4 shadow-none">
              <Plus className="h-3.5 w-3.5 mr-2" />
              新建工作流
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2 space-y-3">
          {workflows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-8 text-center text-muted-foreground">
              还没有工作流。
            </div>
          ) : workflows.map((workflow) => (
            <div key={workflow.id} className="group flex items-start gap-4 p-4 rounded-2xl transition-all border border-transparent hover:bg-black/5 dark:hover:bg-white/5">
              <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-primary bg-primary/10 rounded-full shadow-sm">
                <WorkflowIcon className="h-[22px] w-[22px]" />
              </div>
              <button type="button" onClick={() => setEditing(workflow)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground truncate">{workflow.name}</h2>
                  <span className="text-xs text-muted-foreground">{workflow.steps.length} 个步骤</span>
                  <span className="text-xs text-muted-foreground">{(workflow.executionMode || 'sequential') === 'parallel' ? '并行' : '顺序'}</span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">{workflow.description || workflow.steps.map((step) => step.title).join(' -> ')}</p>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" title="运行" disabled={runningId === workflow.id} onClick={() => void handleRun(workflow)} className="h-8 w-8 rounded-lg">
                  {runningId === workflow.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" title="删除" onClick={() => setWorkflowToDelete(workflow)} className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <WorkflowEditor
          workflow={editing}
          agents={agents}
          onClose={() => setEditing(null)}
          onSave={async (workflow) => {
            await saveWorkflow(workflow);
            setEditing(null);
            toast.success('工作流已保存');
          }}
        />
      )}

      <ConfirmDialog
        open={!!workflowToDelete}
        title="删除工作流"
        message={workflowToDelete ? `确定删除“${workflowToDelete.name}”？` : ''}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="destructive"
        onConfirm={async () => {
          if (!workflowToDelete) return;
          await deleteWorkflow(workflowToDelete.id);
          setWorkflowToDelete(null);
          toast.success('工作流已删除');
        }}
        onCancel={() => setWorkflowToDelete(null)}
      />
    </div>
  );
}

function WorkflowEditor({
  workflow,
  agents,
  onClose,
  onSave,
}: {
  workflow: WorkflowDefinition;
  agents: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (workflow: WorkflowDefinition) => Promise<void>;
}) {
  const [draft, setDraft] = useState(workflow);
  const [saving, setSaving] = useState(false);
  const firstAgentId = agents[0]?.id || 'main';

  const updateStep = (stepId: string, patch: Partial<WorkflowStep>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">{draft.name || '工作流'}</CardTitle>
            <CardDescription className="text-sm mt-1 text-foreground/70">排列步骤，并把每一步分配给对应智能体。</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 -mr-2 -mt-2">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-5 pt-4 overflow-y-auto flex-1 p-6">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_180px]">
            <div className="space-y-2">
              <Label className={labelClasses}>名称</Label>
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClasses} />
            </div>
            <div className="space-y-2">
              <Label className={labelClasses}>描述</Label>
              <Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={inputClasses} />
            </div>
            <div className="space-y-2">
              <Label className={labelClasses}>模式</Label>
              <select
                value={draft.executionMode || 'sequential'}
                onChange={(event) => setDraft({ ...draft, executionMode: event.target.value === 'parallel' ? 'parallel' : 'sequential' })}
                className={selectClasses}
              >
                <option value="sequential">顺序执行</option>
                <option value="parallel">并行执行</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {draft.steps.map((step, index) => (
              <div key={step.id} className="rounded-2xl bg-black/5 dark:bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Bot className="h-4 w-4" />
                    步骤 {index + 1}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={draft.steps.length <= 1}
                    onClick={() => setDraft((current) => ({ ...current, steps: current.steps.filter((candidate) => candidate.id !== step.id) }))}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                  <Input value={step.title} onChange={(event) => updateStep(step.id, { title: event.target.value })} className={inputClasses} />
                  <select value={step.agentId} onChange={(event) => updateStep(step.id, { agentId: event.target.value })} className={selectClasses}>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                </div>
                <textarea
                  value={step.prompt}
                  onChange={(event) => updateStep(step.id, { prompt: event.target.value })}
                  className="min-h-[90px] w-full rounded-xl text-sm bg-transparent border border-black/10 dark:border-white/10 p-3 resize-y"
                  placeholder="写清楚这一步要完成什么"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => setDraft((current) => ({ ...current, steps: [...current.steps, createStep(firstAgentId, current.steps.length)] }))}
              className="h-9 rounded-full px-4"
            >
              <Plus className="h-4 w-4 mr-2" />
              添加步骤
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose} className="h-9 rounded-full px-4">取消</Button>
              <Button
                disabled={saving || !draft.name.trim()}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave({ ...draft, updatedAt: Date.now() });
                  } finally {
                    setSaving(false);
                  }
                }}
                className="h-9 rounded-full px-4"
              >
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {!saving && '保存'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Workflows;
