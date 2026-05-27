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
    title: index === 0 ? 'Plan' : `Step ${index + 1}`,
    prompt: index === 0 ? 'Break down the task and identify the work needed.' : '',
  };
}

function composeWorkflowPrompt(workflow: WorkflowDefinition, agentsById: Record<string, string>): string {
  const steps = workflow.steps.map((step, index) => {
    const agentName = agentsById[step.agentId] || step.agentId;
    return `${index + 1}. ${step.title} (@${agentName})\n${step.prompt}`;
  }).join('\n\n');
  return `Run this multi-agent workflow: ${workflow.name}\n\n${workflow.description ? `${workflow.description}\n\n` : ''}${steps}\n\nExecute the steps in order. When a step names another agent, delegate or route work to that agent where the runtime supports it, then synthesize the final result.`;
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
      name: 'New Workflow',
      description: '',
      steps: [createStep(firstAgentId, 0), createStep(firstAgentId, 1)],
      updatedAt: Date.now(),
    });
  };

  const handleRun = async (workflow: WorkflowDefinition) => {
    setRunningId(workflow.id);
    try {
      navigate('/');
      await sendMessage(composeWorkflowPrompt(workflow, agentsById), undefined, workflow.steps[0]?.agentId || 'main');
      toast.success('Workflow started');
    } catch (err) {
      toast.error(`Failed to start workflow: ${String(err)}`);
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
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">Workflows</h1>
            <p className="text-subtitle text-foreground/70 font-medium">Build reusable multi-agent task flows.</p>
          </div>
          <div className="flex items-center gap-3 md:mt-2">
            <Button variant="outline" onClick={() => void fetchWorkflows()} className="h-9 text-meta font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none">
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={handleNew} className="h-9 text-meta font-medium rounded-full px-4 shadow-none">
              <Plus className="h-3.5 w-3.5 mr-2" />
              Add Workflow
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2 space-y-3">
          {workflows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-8 text-center text-muted-foreground">
              No workflows yet.
            </div>
          ) : workflows.map((workflow) => (
            <div key={workflow.id} className="group flex items-start gap-4 p-4 rounded-2xl transition-all border border-transparent hover:bg-black/5 dark:hover:bg-white/5">
              <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-primary bg-primary/10 rounded-full shadow-sm">
                <WorkflowIcon className="h-[22px] w-[22px]" />
              </div>
              <button type="button" onClick={() => setEditing(workflow)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground truncate">{workflow.name}</h2>
                  <span className="text-xs text-muted-foreground">{workflow.steps.length} steps</span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">{workflow.description || workflow.steps.map((step) => step.title).join(' -> ')}</p>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" title="Run" disabled={runningId === workflow.id} onClick={() => void handleRun(workflow)} className="h-8 w-8 rounded-lg">
                  {runningId === workflow.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" title="Delete" onClick={() => setWorkflowToDelete(workflow)} className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
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
            toast.success('Workflow saved');
          }}
        />
      )}

      <ConfirmDialog
        open={!!workflowToDelete}
        title="Delete Workflow"
        message={workflowToDelete ? `Delete "${workflowToDelete.name}"?` : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={async () => {
          if (!workflowToDelete) return;
          await deleteWorkflow(workflowToDelete.id);
          setWorkflowToDelete(null);
          toast.success('Workflow deleted');
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
            <CardTitle className="text-2xl font-serif font-normal tracking-tight">{draft.name || 'Workflow'}</CardTitle>
            <CardDescription className="text-sm mt-1 text-foreground/70">Arrange steps and assign each step to an agent.</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 -mr-2 -mt-2">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-5 pt-4 overflow-y-auto flex-1 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className={labelClasses}>Name</Label>
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClasses} />
            </div>
            <div className="space-y-2">
              <Label className={labelClasses}>Description</Label>
              <Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={inputClasses} />
            </div>
          </div>

          <div className="space-y-3">
            {draft.steps.map((step, index) => (
              <div key={step.id} className="rounded-2xl bg-black/5 dark:bg-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Bot className="h-4 w-4" />
                    Step {index + 1}
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
                  placeholder="What this step should do"
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
              Add Step
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose} className="h-9 rounded-full px-4">Cancel</Button>
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
                {!saving && 'Save'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Workflows;
