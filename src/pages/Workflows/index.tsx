import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Braces,
  Download,
  GitBranch,
  History,
  Import,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useWorkflowsStore } from '@/stores/workflows';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition, WorkflowStep } from '@/types/workflow';

const inputClasses = 'h-[44px] rounded-xl text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const selectClasses = 'h-[44px] w-full rounded-xl text-meta bg-transparent border border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground px-3';
const labelClasses = 'text-sm text-foreground/80 font-bold';

const TEAM_TEMPLATES = [
  {
    id: 'balanced',
    name: '通用协作组',
    description: '规划、执行、审查、总结都能覆盖，适合日常复杂任务。',
    steps: ['规划任务', '资料或代码处理', '质量审查', '汇总输出'],
  },
  {
    id: 'research',
    name: '研究验证组',
    description: '多路搜索、交叉验证、结论合并，适合实时资料与方案判断。',
    steps: ['拆解问题', '并行检索', '交叉验证', '中文总结'],
  },
  {
    id: 'code',
    name: '开发交付组',
    description: '编码、测试、审查、修复闭环，适合功能开发和代码优化。',
    steps: ['实现功能', '运行检查', '代码审查', '修复与总结'],
  },
];

function createStep(agentId: string, index: number, patch: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    agentId,
    title: index === 0 ? '规划任务' : `步骤 ${index + 1}`,
    prompt: index === 0 ? '拆解任务，确认需要完成的工作。' : '',
    dependsOn: [],
    contextMode: 'isolated',
    fallbackAgentId: '',
    retryCount: 0,
    ...patch,
  };
}

function normalizeStepForPrompt(step: WorkflowStep, index: number, agentsById: Record<string, string>): string {
  const agentName = agentsById[step.agentId] || step.agentId;
  const depends = step.dependsOn?.length ? step.dependsOn.join(', ') : 'none';
  const fallback = step.fallbackAgentId ? `\nFallback agentId: ${step.fallbackAgentId}` : '';
  const retry = step.retryCount ? `\nRetry count: ${step.retryCount}` : '';
  return [
    `${index + 1}. ${step.title}`,
    `Step id: ${step.id}`,
    `Target agentId: ${step.agentId} (${agentName})`,
    `Depends on step ids: ${depends}`,
    `Context mode: ${step.contextMode || 'isolated'}`,
    fallback,
    retry,
    'Task:',
    step.prompt,
  ].filter(Boolean).join('\n');
}

function composeWorkflowPrompt(workflow: WorkflowDefinition, agentsById: Record<string, string>): string {
  const steps = workflow.steps.map((step, index) => normalizeStepForPrompt(step, index, agentsById)).join('\n\n');
  const executionGuidance = {
    sequential: '按顺序执行步骤。任何分配给其他智能体的步骤，都必须用 sessions_spawn 并传入 exact target agentId；需要结果时调用 sessions_yield，然后继续下一步。',
    parallel: '先用 sessions_spawn 启动所有彼此独立的步骤，每一步都必须使用对应的 exact target agentId。然后调用 sessions_yield 收集子任务结果，并综合输出。',
    dag: '把 dependsOn 为空的步骤先并行启动；某步骤的依赖完成后再启动该步骤。每次 sessions_spawn 都必须传入 exact target agentId，并在需要汇总时调用 sessions_yield。',
  }[workflow.executionMode || 'sequential'];
  return [
    `执行这个多智能体工作流：${workflow.name}`,
    workflow.description ? `描述：${workflow.description}` : '',
    `执行模式：${workflow.executionMode}`,
    workflow.teamTemplate ? `团队模板：${workflow.teamTemplate}` : '',
    workflow.reviewerAgentId ? `审查智能体 agentId：${workflow.reviewerAgentId}` : '',
    workflow.maxRuntimeMinutes ? `最长运行时间：${workflow.maxRuntimeMinutes} minutes` : '',
    workflow.maxTokenBudget ? `最大 token 预算：${workflow.maxTokenBudget}` : '',
    `智能体分配策略：${workflow.assignmentStrategy || 'manual'}`,
    `模型速度策略：${workflow.modelStrategy || 'balanced'}`,
    '',
    'Delegation protocol:',
    '- 委托给其他智能体时必须实际调用 sessions_spawn，不要只在文字里描述委托。',
    '- 始终把步骤目标作为 agentId 传入。',
    '- contextMode 为 isolated 时只传递必要任务摘要；为 fork 时可携带当前上下文。',
    '- assignmentStrategy 为 auto 时，先用 agents_list 判断每个智能体能力，再选择最合适的 exact agentId；manual 时严格使用步骤里的 agentId。',
    '- modelStrategy 为 fast 时优先把独立子任务交给更快/更便宜的智能体模型；quality 时保留复杂推理给高质量模型；balanced 时在速度和质量之间折中。',
    '- 步骤失败时，先按 retryCount 重试；仍失败且 fallbackAgentId 存在时，改用备用智能体。',
    '- 子任务结果是证据；最终回答前要核对、去重、处理冲突，并由 reviewerAgentId 审查或总结。',
    `- ${executionGuidance}`,
    '',
    '工作流步骤：',
    steps,
  ].filter(Boolean).join('\n');
}

function applyTeamTemplate(baseAgentId: string, templateId: string): Pick<WorkflowDefinition, 'teamTemplate' | 'executionMode' | 'steps' | 'reviewerAgentId'> {
  const template = TEAM_TEMPLATES.find((item) => item.id === templateId) ?? TEAM_TEMPLATES[0];
  const steps = template.steps.map((title, index) => createStep(baseAgentId, index, {
    title,
    prompt: `${title}。请保持输出简洁、可验证，并说明需要交给下一步的要点。`,
    dependsOn: index === 0 ? [] : templateId === 'research' && index === 1 ? [] : [stepsIdPlaceholder(index - 1)],
  }));
  const idByIndex = steps.map((step) => step.id);
  return {
    teamTemplate: template.id,
    executionMode: templateId === 'balanced' ? 'parallel' : 'dag',
    reviewerAgentId: baseAgentId,
    steps: steps.map((step) => ({
      ...step,
      dependsOn: (step.dependsOn ?? []).map((id) => id.startsWith('__previous_') ? idByIndex[Number(id.slice('__previous_'.length))] : id),
    })),
  };
}

function stepsIdPlaceholder(index: number): string {
  return `__previous_${index}`;
}

export function Workflows() {
  const navigate = useNavigate();
  const { workflows, runs, loading, error, fetchWorkflows, saveWorkflow, deleteWorkflow, saveRun, deleteRun } = useWorkflowsStore();
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
      executionMode: 'dag',
      teamTemplate: 'balanced',
      reviewerAgentId: firstAgentId,
      assignmentStrategy: 'manual',
      modelStrategy: 'balanced',
      steps: [createStep(firstAgentId, 0), createStep(firstAgentId, 1, { dependsOn: [] })],
      updatedAt: Date.now(),
    });
  };

  const handleRun = async (workflow: WorkflowDefinition) => {
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    setRunningId(workflow.id);
    try {
      navigate('/');
      await saveRun({
        id: runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        executionMode: workflow.executionMode,
        status: 'running',
        startedAt,
        stepCount: workflow.steps.length,
        agentIds: [...new Set(workflow.steps.map((step) => step.agentId))],
      });
      await sendMessage(composeWorkflowPrompt(workflow, agentsById), undefined, workflow.steps[0]?.agentId || 'main');
      await saveRun({
        id: runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        executionMode: workflow.executionMode,
        status: 'completed',
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        sessionKey: useChatStore.getState().currentSessionKey,
        stepCount: workflow.steps.length,
        agentIds: [...new Set(workflow.steps.map((step) => step.agentId))],
      });
      toast.success('工作流已启动');
    } catch (err) {
      await saveRun({
        id: runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        executionMode: workflow.executionMode,
        status: 'failed',
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        stepCount: workflow.steps.length,
        agentIds: [...new Set(workflow.steps.map((step) => step.agentId))],
        error: String(err),
      }).catch(() => undefined);
      toast.error(`启动工作流失败：${String(err)}`);
    } finally {
      setRunningId(null);
    }
  };

  const exportWorkflows = async () => {
    const payload = JSON.stringify({ workflows, exportedAt: new Date().toISOString(), source: 'ClawX workflows' }, null, 2);
    await navigator.clipboard.writeText(payload);
    toast.success('工作流 JSON 已复制');
  };

  const importWorkflows = () => {
    const raw = window.prompt('粘贴工作流 JSON');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { workflows?: Partial<WorkflowDefinition>[] };
      const candidates = Array.isArray(parsed.workflows) ? parsed.workflows : [];
      if (candidates.length === 0) throw new Error('没有找到 workflows 数组');
      void Promise.all(candidates.map((workflow) => saveWorkflow({ ...workflow, id: workflow.id || crypto.randomUUID() })))
        .then(() => {
          void fetchWorkflows();
          toast.success(`已导入 ${candidates.length} 个工作流`);
        })
        .catch((importError) => toast.error(`导入失败：${String(importError)}`));
    } catch (importError) {
      toast.error(`导入失败：${String(importError)}`);
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
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-10 pt-16">
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-10 shrink-0 gap-4">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">工作流</h1>
            <p className="text-subtitle text-foreground/70 font-medium">编排可复用的并行智能体、依赖步骤和审查流程。</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button variant="outline" onClick={() => void fetchWorkflows()} className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none">
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button variant="outline" onClick={exportWorkflows} className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none">
              <Download className="h-3.5 w-3.5 mr-2" />
              导出
            </Button>
            <Button variant="outline" onClick={importWorkflows} className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none">
              <Import className="h-3.5 w-3.5 mr-2" />
              导入
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
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground truncate">{workflow.name}</h2>
                  <span className="text-xs text-muted-foreground">{workflow.steps.length} 个步骤</span>
                  <span className="text-xs text-muted-foreground">{workflow.executionMode === 'dag' ? '依赖图' : workflow.executionMode === 'parallel' ? '并行' : '顺序'}</span>
                  {workflow.teamTemplate && <span className="text-xs text-muted-foreground">团队：{workflow.teamTemplate}</span>}
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

        {runs.length > 0 && (
          <div className="shrink-0 border-t border-black/10 pt-4 dark:border-white/10">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="h-4 w-4" />
              最近运行
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {runs.slice(0, 4).map((run) => (
                <div key={run.id} className="flex items-center gap-3 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', run.status === 'failed' ? 'bg-red-500' : run.status === 'running' ? 'bg-blue-500' : 'bg-emerald-500')} />
                  <button
                    type="button"
                    onClick={() => {
                      if (!run.sessionKey) return;
                      useChatStore.getState().switchSession(run.sessionKey);
                      navigate('/');
                    }}
                    className="min-w-0 flex-1 text-left"
                    title={run.sessionKey}
                  >
                    <p className="truncate font-medium text-foreground">{run.workflowName}</p>
                    <p className="truncate text-xs text-muted-foreground">{run.status} · {run.stepCount} 步 · {run.agentIds.join(', ')}</p>
                  </button>
                  <Button variant="ghost" size="icon" onClick={() => void deleteRun(run.id)} className="h-7 w-7">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
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

  const applyTemplate = (templateId: string) => {
    setDraft((current) => ({
      ...current,
      ...applyTeamTemplate(firstAgentId, templateId),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-3xl border-0 shadow-2xl bg-surface-modal overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">{draft.name || '工作流'}</CardTitle>
            <CardDescription className="text-sm mt-1 text-foreground/70">配置并行智能体、依赖图、重试和审查策略。</CardDescription>
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
                onChange={(event) => setDraft({ ...draft, executionMode: event.target.value as WorkflowDefinition['executionMode'] })}
                className={selectClasses}
              >
                <option value="sequential">顺序执行</option>
                <option value="parallel">并行执行</option>
                <option value="dag">依赖图 DAG</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {TEAM_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template.id)}
                className={cn(
                  'rounded-2xl border p-4 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5',
                  draft.teamTemplate === template.id ? 'border-primary bg-primary/10' : 'border-black/10 dark:border-white/10',
                )}
              >
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Users className="h-4 w-4" />
                  {template.name}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{template.description}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-5">
            <div className="space-y-2">
              <Label className={labelClasses}>审查智能体</Label>
              <select value={draft.reviewerAgentId || ''} onChange={(event) => setDraft({ ...draft, reviewerAgentId: event.target.value || undefined })} className={selectClasses}>
                <option value="">不指定</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label className={labelClasses}>分配策略</Label>
              <select value={draft.assignmentStrategy || 'manual'} onChange={(event) => setDraft({ ...draft, assignmentStrategy: event.target.value as WorkflowDefinition['assignmentStrategy'] })} className={selectClasses}>
                <option value="manual">手动 agentId</option>
                <option value="auto">自动匹配</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label className={labelClasses}>模型策略</Label>
              <select value={draft.modelStrategy || 'balanced'} onChange={(event) => setDraft({ ...draft, modelStrategy: event.target.value as WorkflowDefinition['modelStrategy'] })} className={selectClasses}>
                <option value="balanced">均衡</option>
                <option value="fast">速度优先</option>
                <option value="quality">质量优先</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label className={labelClasses}>最长运行分钟</Label>
              <Input
                type="number"
                min={0}
                value={draft.maxRuntimeMinutes ?? ''}
                onChange={(event) => setDraft({ ...draft, maxRuntimeMinutes: event.target.value ? Number(event.target.value) : undefined })}
                className={inputClasses}
                placeholder="不限制"
              />
            </div>
            <div className="space-y-2">
              <Label className={labelClasses}>Token 预算</Label>
              <Input
                type="number"
                min={0}
                value={draft.maxTokenBudget ?? ''}
                onChange={(event) => setDraft({ ...draft, maxTokenBudget: event.target.value ? Number(event.target.value) : undefined })}
                className={inputClasses}
                placeholder="不限制"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <InfoPill icon={<GitBranch className="h-4 w-4" />} title="依赖图" detail="步骤可等待指定前置步骤完成" />
            <InfoPill icon={<RotateCcw className="h-4 w-4" />} title="重试与备用" detail="失败后可重试或换备用智能体" />
            <InfoPill icon={<Braces className="h-4 w-4" />} title="上下文模式" detail="isolated 更轻，fork 带当前上下文" />
            <InfoPill icon={<ShieldCheck className="h-4 w-4" />} title="审查合并" detail="最终输出前可交给审查智能体" />
          </div>

          <div className="space-y-3">
            {draft.steps.map((step, index) => (
              <div key={step.id} className="rounded-2xl bg-black/5 dark:bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Bot className="h-4 w-4" />
                    步骤 {index + 1}
                    <span className="text-xs font-normal text-muted-foreground">id: {step.id.slice(0, 8)}</span>
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
                <div className="grid gap-3 md:grid-cols-[1fr_210px_170px]">
                  <Input value={step.title} onChange={(event) => updateStep(step.id, { title: event.target.value })} className={inputClasses} />
                  <select value={step.agentId} onChange={(event) => updateStep(step.id, { agentId: event.target.value })} className={selectClasses}>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                  <select value={step.contextMode || 'isolated'} onChange={(event) => updateStep(step.id, { contextMode: event.target.value as WorkflowStep['contextMode'] })} className={selectClasses}>
                    <option value="isolated">isolated</option>
                    <option value="fork">fork</option>
                  </select>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
                  <select
                    multiple
                    value={step.dependsOn ?? []}
                    onChange={(event) => updateStep(step.id, { dependsOn: Array.from(event.target.selectedOptions).map((option) => option.value) })}
                    className="min-h-[76px] w-full rounded-xl text-meta bg-transparent border border-black/10 dark:border-white/10 p-3"
                  >
                    {draft.steps.filter((candidate) => candidate.id !== step.id).map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{candidate.title || candidate.id}</option>
                    ))}
                  </select>
                  <select value={step.fallbackAgentId || ''} onChange={(event) => updateStep(step.id, { fallbackAgentId: event.target.value })} className={selectClasses}>
                    <option value="">无备用</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={step.retryCount ?? 0}
                    onChange={(event) => updateStep(step.id, { retryCount: Number(event.target.value) || 0 })}
                    className={inputClasses}
                    placeholder="重试次数"
                  />
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

function InfoPill({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

export default Workflows;
