import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  Bot,
  Brain,
  Code2,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommit,
  History,
  Layers,
  MemoryStick,
  Pause,
  Package,
  Play,
  Plus,
  RefreshCw,
  Route,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useWorkbenchStore } from '@/stores/workbench';
import { useWorkflowsStore } from '@/stores/workflows';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/types/agent';
import type { AlwaysOnTask, RoutingRule, WorkbenchProject } from '@/types/workbench';

const MonacoViewerLazy = lazy(() => import('@/components/file-preview/MonacoViewer'));
const MonacoDiffViewerLazy = lazy(() => import('@/components/file-preview/MonacoDiffViewer'));

interface WorkspaceEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size?: number;
}

type WorkbenchModal = 'memory' | 'task' | 'route' | 'report' | null;

const inputClasses = 'h-[42px] rounded-xl text-sm bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const selectClasses = 'h-[42px] w-full rounded-xl text-sm bg-transparent border border-black/10 dark:border-white/10 px-3 text-foreground';

function formatTime(value?: number) {
  if (!value) return '从未';
  return new Date(value).toLocaleString();
}

function agentName(agents: AgentSummary[], agentId: string) {
  return agents.find((agent) => agent.id === agentId)?.name || agentId;
}

function seedProjectFromAgent(agent: AgentSummary): WorkbenchProject {
  const timestamp = Date.now();
  return {
    id: crypto.randomUUID(),
    name: agent.name || agent.id,
    description: '从当前智能体生成的隔离工作区。',
    agentId: agent.id,
    workspace: agent.workspace,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function Workbench() {
  const navigate = useNavigate();
  const { agents, fetchAgents } = useAgentsStore();
  const { runs, fetchWorkflows } = useWorkflowsStore();
  const sendMessage = useChatStore((state) => state.sendMessage);
  const {
    hydrated,
    projects,
    memories,
    alwaysOnTasks,
    routingRules,
    reports,
    hydrate,
    saveProject,
    deleteProject,
    saveMemory,
    deleteMemory,
    saveAlwaysOnTask,
    markAlwaysOnTaskRun,
    deleteAlwaysOnTask,
    saveRoutingRule,
    deleteRoutingRule,
    saveReport,
    deleteReport,
  } = useWorkbenchStore();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [originalFileContent, setOriginalFileContent] = useState('');
  const [showFileDiff, setShowFileDiff] = useState(false);
  const [gitStatus, setGitStatus] = useState('');
  const [gitDiff, setGitDiff] = useState('');
  const [gitLog, setGitLog] = useState('');
  const [activeModal, setActiveModal] = useState<WorkbenchModal>(null);
  const [memoryDraft, setMemoryDraft] = useState({ title: '', content: '', confidence: 'medium' as const });
  const [taskDraft, setTaskDraft] = useState({ title: '', objective: '', cadence: 'daily' as AlwaysOnTask['cadence'] });
  const [routeDraft, setRouteDraft] = useState({
    name: '',
    matcher: '',
    preferredModelStrategy: 'balanced' as RoutingRule['preferredModelStrategy'],
    targetAgentId: '',
    notes: '',
  });
  const [reportDraft, setReportDraft] = useState({ title: '', summary: '' });
  const effectiveSelectedProjectId = selectedProjectId || projects[0]?.id || '';
  const selectedProject = projects.find((project) => project.id === effectiveSelectedProjectId) || projects[0] || null;
  const selectedWorkspace = selectedProject?.workspace;
  const fileDirty = selectedFilePath !== '' && selectedFileContent !== originalFileContent;

  useEffect(() => {
    void hydrate();
    void Promise.all([fetchAgents(), fetchWorkflows()]);
  }, [fetchAgents, fetchWorkflows, hydrate]);

  useEffect(() => {
    if (!hydrated || projects.length > 0 || agents.length === 0) return;
    agents.forEach((agent) => void saveProject(seedProjectFromAgent(agent)));
  }, [agents, hydrated, projects.length, saveProject]);

  const projectMemories = useMemo(
    () => memories.filter((memory) => !selectedProject || memory.projectId === selectedProject.id),
    [memories, selectedProject],
  );
  const projectTasks = useMemo(
    () => alwaysOnTasks.filter((task) => !selectedProject || task.projectId === selectedProject.id),
    [alwaysOnTasks, selectedProject],
  );
  const projectReports = useMemo(
    () => reports.filter((report) => !selectedProject || report.projectId === selectedProject.id),
    [reports, selectedProject],
  );

  const refreshWorkspaceTools = useCallback(async () => {
    if (!selectedWorkspace) return;
    try {
      const [tree, git, diff, log] = await Promise.all([
        hostApiFetch<{ entries?: WorkspaceEntry[] }>(`/api/workbench/files?workspace=${encodeURIComponent(selectedWorkspace)}`),
        hostApiFetch<{ output?: string }>(`/api/workbench/git-status?workspace=${encodeURIComponent(selectedWorkspace)}`),
        hostApiFetch<{ output?: string }>(`/api/workbench/git-diff?workspace=${encodeURIComponent(selectedWorkspace)}`),
        hostApiFetch<{ output?: string }>(`/api/workbench/git-log?workspace=${encodeURIComponent(selectedWorkspace)}`),
      ]);
      setWorkspaceEntries(tree.entries ?? []);
      setGitStatus(git.output || '没有 Git 输出。');
      setGitDiff(diff.output || '没有工作区 diff。');
      setGitLog(log.output || '没有 Git 历史。');
    } catch (error) {
      setGitStatus(String(error));
      setGitDiff('');
      setGitLog('');
    }
  }, [selectedWorkspace]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelectedFilePath('');
      setSelectedFileContent('');
      setOriginalFileContent('');
      setShowFileDiff(false);
      setWorkspaceEntries([]);
      setGitStatus('');
      setGitDiff('');
      setGitLog('');
      void refreshWorkspaceTools();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshWorkspaceTools, selectedProject?.id, selectedWorkspace]);

  const openWorkspaceFile = async (path: string) => {
    if (!selectedProject?.workspace) return;
    try {
      const result = await hostApiFetch<{ content?: string }>(
        `/api/workbench/file?workspace=${encodeURIComponent(selectedProject.workspace)}&path=${encodeURIComponent(path)}`,
      );
      setSelectedFilePath(path);
      setSelectedFileContent(result.content ?? '');
      setOriginalFileContent(result.content ?? '');
      setShowFileDiff(false);
    } catch (error) {
      toast.error(String(error));
    }
  };

  const saveWorkspaceFile = async () => {
    if (!selectedProject?.workspace || !selectedFilePath) return;
    try {
      await hostApiFetch('/api/workbench/file', {
        method: 'PUT',
        body: JSON.stringify({
          workspace: selectedProject.workspace,
          path: selectedFilePath,
          content: selectedFileContent,
        }),
      });
      toast.success('文件已保存');
      setOriginalFileContent(selectedFileContent);
      setShowFileDiff(false);
      await refreshWorkspaceTools();
    } catch (error) {
      toast.error(String(error));
    }
  };

  const refreshSelectedFileDiff = async () => {
    if (!selectedProject?.workspace || !selectedFilePath) return;
    try {
      const result = await hostApiFetch<{ output?: string }>(
        `/api/workbench/git-diff?workspace=${encodeURIComponent(selectedProject.workspace)}&path=${encodeURIComponent(selectedFilePath)}`,
      );
      setGitDiff(result.output || '当前文件没有 diff。');
    } catch (error) {
      setGitDiff(String(error));
    }
  };

  const commitWorkspace = async () => {
    if (!selectedProject?.workspace) return;
    const message = window.prompt('提交说明');
    if (!message) return;
    try {
      const result = await hostApiFetch<{ ok?: boolean; output?: string }>('/api/workbench/git-commit', {
        method: 'POST',
        body: JSON.stringify({ workspace: selectedProject.workspace, message }),
      });
      if (result.ok) {
        toast.success('Git 提交已完成');
      } else {
        toast.error(result.output || 'Git 提交失败');
      }
      await refreshWorkspaceTools();
    } catch (error) {
      toast.error(String(error));
    }
  };

  const createMemory = () => {
    if (!selectedProject) {
      toast.error('请先选择或创建工作区');
      return;
    }
    setMemoryDraft({ title: '', content: '', confidence: 'medium' });
    setActiveModal('memory');
  };

  const createAlwaysOnTask = () => {
    if (!selectedProject) {
      toast.error('请先选择或创建工作区');
      return;
    }
    setTaskDraft({ title: '', objective: '', cadence: 'daily' });
    setActiveModal('task');
  };

  const createRoutingRule = () => {
    setRouteDraft({
      name: '',
      matcher: '',
      preferredModelStrategy: 'balanced',
      targetAgentId: selectedProject?.agentId || agents[0]?.id || 'main',
      notes: '',
    });
    setActiveModal('route');
  };

  const createReportFromLatestRun = () => {
    if (!selectedProject) {
      toast.error('请先选择或创建工作区');
      return;
    }
    const latest = runs[0];
    setReportDraft({
      title: latest ? `${latest.workflowName} 运行报告` : '手动运行报告',
      summary: latest
        ? `状态：${latest.status}\n步骤：${latest.stepCount}\n智能体：${latest.agentIds.join(', ')}\n会话：${latest.sessionKey || '无'}`
        : '暂无工作流记录，可手动补充本次任务的结论、文件和风险。',
    });
    setActiveModal('report');
  };

  const closeModal = () => setActiveModal(null);

  const submitMemory = async () => {
    if (!selectedProject) return;
    const title = memoryDraft.title.trim();
    if (!title) {
      toast.error('请填写记忆标题');
      return;
    }
    await saveMemory({
      projectId: selectedProject.id,
      title,
      content: memoryDraft.content.trim(),
      source: 'manual',
      confidence: memoryDraft.confidence,
      status: 'active',
    });
    toast.success('记忆已保存');
    closeModal();
  };

  const submitTask = async () => {
    if (!selectedProject) return;
    const title = taskDraft.title.trim();
    if (!title) {
      toast.error('请填写任务名称');
      return;
    }
    await saveAlwaysOnTask({
      projectId: selectedProject.id,
      title,
      objective: taskDraft.objective.trim(),
      cadence: taskDraft.cadence,
      status: 'active',
      nextRunHint: taskDraft.cadence === 'manual' ? '手动运行' : `按 ${taskDraft.cadence} 自动检查`,
    });
    toast.success('后台任务已保存');
    closeModal();
  };

  const submitRoute = async () => {
    const name = routeDraft.name.trim();
    if (!name) {
      toast.error('请填写规则名称');
      return;
    }
    await saveRoutingRule({
      name,
      matcher: routeDraft.matcher.trim(),
      complexity: 'normal',
      preferredModelStrategy: routeDraft.preferredModelStrategy,
      targetAgentId: routeDraft.targetAgentId || selectedProject?.agentId || agents[0]?.id || 'main',
      notes: routeDraft.notes.trim() || undefined,
      enabled: true,
    });
    toast.success('路由规则已保存');
    closeModal();
  };

  const submitReport = async () => {
    if (!selectedProject) return;
    const title = reportDraft.title.trim();
    if (!title) {
      toast.error('请填写报告标题');
      return;
    }
    await saveReport({
      projectId: selectedProject.id,
      title,
      summary: reportDraft.summary.trim(),
      status: 'draft',
    });
    toast.success('报告已生成');
    closeModal();
  };

  const runAlwaysOnTask = useCallback(async (title: string, objective: string, project = selectedProject, taskId?: string) => {
    if (!project) return;
    const startedAt = Date.now();
    try {
      if (taskId) await markAlwaysOnTaskRun(taskId, 'queued', project.agentId);
      navigate('/');
      if (taskId) await markAlwaysOnTaskRun(taskId, 'running', project.agentId);
      await sendMessage([
        `执行 Always-on 后台任务：${title}`,
        `项目：${project.name}`,
        `工作区：${project.workspace || '未配置'}`,
        '',
        '要求：',
        objective,
        '',
        '请输出进度、结果文件、下一步建议，并把可长期记忆的事实单独列出。',
      ].join('\n'), undefined, project.agentId);
      if (taskId) await markAlwaysOnTaskRun(taskId, 'completed', project.agentId);
      await saveReport({
        projectId: project.id,
        title: `${title} 运行报告`,
        summary: [
          `Always-on 后台任务已提交给 ${agentName(agents, project.agentId)}。`,
          `工作区：${project.workspace || '未配置'}`,
          `任务：${objective || '未填写目标'}`,
        ].join('\n'),
        status: 'final',
        taskId,
        agentId: project.agentId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = String(error);
      if (taskId) await markAlwaysOnTaskRun(taskId, 'failed', project.agentId, message);
      await saveReport({
        projectId: project.id,
        title: `${title} 失败报告`,
        summary: `Always-on 后台任务执行失败。\n错误：${message}`,
        status: 'draft',
        taskId,
        agentId: project.agentId,
        durationMs: Date.now() - startedAt,
      });
      toast.error(String(error));
    }
  }, [agents, markAlwaysOnTaskRun, navigate, saveReport, selectedProject, sendMessage]);

  useEffect(() => {
    if (!hydrated) return;
    const tick = () => {
      const now = Date.now();
      const due = alwaysOnTasks.find((task) => (
        task.status === 'active'
        && task.cadence !== 'manual'
        && typeof task.nextRunAt === 'number'
        && task.nextRunAt <= now
      ));
      if (!due) return;
      const project = projects.find((item) => item.id === due.projectId);
      if (!project) return;
      void runAlwaysOnTask(due.title, due.objective, project, due.id);
    };
    const timer = window.setInterval(tick, 60_000);
    tick();
    return () => window.clearInterval(timer);
  }, [alwaysOnTasks, hydrated, projects, runAlwaysOnTask]);

  return (
    <div data-testid="workbench-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-7xl mx-auto flex flex-col h-full p-10 pt-14">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">工作台</h1>
            <p className="text-subtitle text-foreground/70 font-medium">PilotDeck 风格的项目隔离、白盒记忆、后台任务、智能路由和运行报告。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void Promise.all([fetchAgents(), fetchWorkflows()])} className="h-9 rounded-full px-4">
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新
            </Button>
            <Button onClick={() => agents[0] && void saveProject(seedProjectFromAgent(agents[0]))} className="h-9 rounded-full px-4">
              <Plus className="mr-2 h-4 w-4" />
              新建工作区
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[300px_1fr]">
          <div className="min-h-0 overflow-y-auto rounded-2xl border border-black/10 p-3 dark:border-white/10">
            <div className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
              <Layers className="h-4 w-4" />
              工作区隔离
            </div>
            <div className="space-y-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                  className={cn(
                    'w-full rounded-xl p-3 text-left transition-colors',
                    selectedProject?.id === project.id ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{project.name}</p>
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-2xs text-muted-foreground dark:bg-white/10">{project.status}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{agentName(agents, project.agentId)}</p>
                  <p className="mt-1 truncate text-2xs text-muted-foreground">{project.workspace || '未绑定目录'}</p>
                </button>
              ))}
              {projects.length === 0 && (
                <p className="rounded-xl bg-black/5 p-4 text-sm text-muted-foreground dark:bg-white/5">还没有工作区。</p>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto pr-2 space-y-4">
            <div className="grid gap-4 xl:grid-cols-4">
              <MetricCard icon={<MemoryStick className="h-4 w-4" />} label="白盒记忆" value={String(projectMemories.length)} />
              <MetricCard icon={<Play className="h-4 w-4" />} label="Always-on" value={String(projectTasks.filter((task) => task.status === 'active').length)} />
              <MetricCard icon={<Route className="h-4 w-4" />} label="路由规则" value={String(routingRules.filter((rule) => rule.enabled).length)} />
              <MetricCard icon={<History className="h-4 w-4" />} label="运行报告" value={String(projectReports.length + runs.length)} />
            </div>

            {selectedProject && (
              <Card className="rounded-2xl border-black/10 bg-transparent dark:border-white/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <ShieldCheck className="h-5 w-5" />
                    {selectedProject.name}
                  </CardTitle>
                  <CardDescription>工作区、智能体和项目记忆在这里绑定，避免不同任务互相污染。</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-[1fr_220px_180px]">
                  <div className="space-y-2">
                    <Label>工作区路径</Label>
                    <Input value={selectedProject.workspace} onChange={(event) => void saveProject({ ...selectedProject, workspace: event.target.value })} className={inputClasses} />
                  </div>
                  <div className="space-y-2">
                    <Label>绑定智能体</Label>
                    <select value={selectedProject.agentId} onChange={(event) => void saveProject({ ...selectedProject, agentId: event.target.value })} className={selectClasses}>
                      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button variant="outline" onClick={() => selectedProject.workspace && invokeIpc('shell:openPath', selectedProject.workspace)} className="h-[42px] flex-1 rounded-xl">
                      <FolderOpen className="mr-2 h-4 w-4" />
                      打开
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void deleteProject(selectedProject.id)} className="h-[42px] w-[42px] rounded-xl text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <CapabilityCard title="白盒记忆管理" icon={<Brain className="h-5 w-5" />} actionLabel="新增记忆" onAction={createMemory}>
                {projectMemories.slice(0, 5).map((memory) => (
                  <Row
                    key={memory.id}
                    title={memory.title}
                    detail={`${memory.confidence} · ${memory.source} · ${formatTime(memory.updatedAt)}`}
                    onDelete={() => void deleteMemory(memory.id)}
                  />
                ))}
                {projectMemories.length === 0 && <EmptyText text="暂无记忆。可把重要偏好、项目事实、错误修正写入这里。" />}
              </CapabilityCard>

              <CapabilityCard title="Always-on 后台任务" icon={<Play className="h-5 w-5" />} actionLabel="新增任务" onAction={createAlwaysOnTask}>
                {projectTasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void saveAlwaysOnTask({ ...task, status: task.status === 'active' ? 'paused' : 'active' })}
                          className="h-7 w-7"
                          title={task.status === 'active' ? '暂停' : '启用'}
                        >
                          {task.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => void runAlwaysOnTask(task.title, task.objective, selectedProject, task.id)} className="h-7 w-7">
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => void deleteAlwaysOnTask(task.id)} className="h-7 w-7 text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.objective || task.nextRunHint}</p>
                    <p className="mt-2 text-2xs text-muted-foreground">
                      {task.cadence} · {task.status} · 次数 {task.runCount} · 下次 {formatTime(task.nextRunAt)} · {task.lastRunStatus || '未运行'}
                    </p>
                    {task.lastRunError && <p className="mt-1 line-clamp-2 text-2xs text-destructive">{task.lastRunError}</p>}
                  </div>
                ))}
                {projectTasks.length === 0 && <EmptyText text="暂无后台任务。可用于长期监控、定期总结、自动推进项目。" />}
              </CapabilityCard>

              <CapabilityCard title="智能模型路由" icon={<Route className="h-5 w-5" />} actionLabel="新增规则" onAction={createRoutingRule}>
                {routingRules.slice(0, 5).map((rule) => (
                  <Row key={rule.id} title={rule.name} detail={`${rule.matcher || '全部'} · ${rule.complexity} · ${rule.preferredModelStrategy} · ${agentName(agents, rule.targetAgentId)}${rule.notes ? ` · ${rule.notes}` : ''}`} onDelete={() => void deleteRoutingRule(rule.id)} />
                ))}
                {routingRules.length === 0 && <EmptyText text="暂无路由规则。可以按关键词、复杂度和模型策略把任务分发给不同智能体。" />}
              </CapabilityCard>

              <CapabilityCard title="任务历史 / 运行报告" icon={<History className="h-5 w-5" />} actionLabel="生成报告" onAction={createReportFromLatestRun}>
                {projectReports.slice(0, 3).map((report) => (
                  <Row key={report.id} title={report.title} detail={`${report.status} · ${report.agentId || 'agent'} · ${report.durationMs ? `${Math.round(report.durationMs / 1000)}s` : '未计时'} · ${formatTime(report.createdAt)}`} onDelete={() => void deleteReport(report.id)} />
                ))}
                {runs.slice(0, 3).map((run) => (
                  <div key={run.id} className="rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5">
                    <p className="truncate font-semibold text-foreground">{run.workflowName}</p>
                    <p className="truncate text-xs text-muted-foreground">{run.status} · {run.stepCount} 步 · {run.agentIds.join(', ')}</p>
                  </div>
                ))}
              </CapabilityCard>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <ActionTile icon={<Bot className="h-5 w-5" />} title="更完整的子智能体过程展示" detail="聊天执行图已显示并行智能体看板、spawn/yield、记录跳转和停止总运行。" action="打开聊天" onClick={() => navigate('/')} />
              <ActionTile icon={<Package className="h-5 w-5" />} title="插件 / MCP 扩展体系" detail="当前先接入 Skills 与 OpenClaw 插件；后续可把 MCP 服务做成独立管理页。" action="打开技能" onClick={() => navigate('/skills')} />
              <ActionTile icon={<Code2 className="h-5 w-5" />} title="文件树 + Git + 代码工作区" detail="下方已接入工作区文件浏览、Git 状态和轻量文本编辑；代码审查可由绑定智能体直接运行。" action="发起 Git 检查" onClick={() => selectedProject && void sendMessage(`检查工作区 Git 状态并总结代码风险：${selectedProject.workspace}`, undefined, selectedProject.agentId)} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
              <Card className="rounded-2xl border-black/10 bg-transparent dark:border-white/10">
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <GitBranch className="h-5 w-5" />
                    文件树 / Git
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => void commitWorkspace()} className="h-8 rounded-full px-3 text-xs">
                      <GitCommit className="mr-1.5 h-3.5 w-3.5" />
                      提交
                    </Button>
                    <Button variant="outline" onClick={() => void refreshWorkspaceTools()} className="h-8 rounded-full px-3 text-xs">
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      刷新
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="max-h-64 overflow-y-auto rounded-xl bg-black/5 p-2 text-sm dark:bg-white/5">
                    {workspaceEntries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        disabled={entry.type !== 'file'}
                        onClick={() => void openWorkspaceFile(entry.path)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs',
                          entry.type === 'file' ? 'hover:bg-black/5 dark:hover:bg-white/10' : 'text-muted-foreground',
                          selectedFilePath === entry.path && 'bg-primary/10 text-foreground',
                        )}
                      >
                        <span className="w-7 shrink-0 text-2xs">{entry.type === 'dir' ? 'dir' : 'file'}</span>
                        <span className="truncate">{entry.path}</span>
                      </button>
                    ))}
                    {workspaceEntries.length === 0 && <EmptyText text="未读取到文件。请确认工作区路径存在。" />}
                  </div>
                  <div className="grid gap-2">
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-black/5 p-3 text-xs text-muted-foreground dark:bg-white/5">{gitStatus || '暂无 Git 状态。'}</pre>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-black/5 p-3 text-xs text-muted-foreground dark:bg-white/5">{gitLog || '暂无 Git 历史。'}</pre>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-black/5 p-3 text-xs text-muted-foreground dark:bg-white/5">{gitDiff || '暂无 Git diff。'}</pre>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-black/10 bg-transparent dark:border-white/10">
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="flex min-w-0 items-center gap-2 truncate text-lg">
                    <FileText className="h-5 w-5 shrink-0" />
                    <span className="truncate">{selectedFilePath || '代码编辑器'}</span>
                    {fileDirty && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs text-amber-600 dark:text-amber-300">未保存</span>}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" disabled={!selectedFilePath} onClick={() => { setShowFileDiff((value) => !value); void refreshSelectedFileDiff(); }} className="h-8 rounded-full px-3 text-xs">
                      <Code2 className="mr-1.5 h-3.5 w-3.5" />
                      Diff
                    </Button>
                    <Button variant="outline" disabled={!selectedFilePath || !fileDirty} onClick={() => void saveWorkspaceFile()} className="h-8 rounded-full px-3 text-xs">
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      保存
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="min-h-[420px]">
                  {selectedFilePath ? (
                    <Suspense fallback={<div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">正在加载编辑器...</div>}>
                      {showFileDiff ? (
                        <MonacoDiffViewerLazy
                          filePath={selectedFilePath}
                          original={originalFileContent}
                          modified={selectedFileContent}
                          className="h-[420px] rounded-xl border border-black/10 dark:border-white/10"
                        />
                      ) : (
                        <MonacoViewerLazy
                          filePath={selectedFilePath}
                          value={selectedFileContent}
                          onChange={setSelectedFileContent}
                          className="h-[420px] rounded-xl border border-black/10 dark:border-white/10"
                        />
                      )}
                    </Suspense>
                  ) : (
                    <EmptyText text="从左侧选择一个文本文件进行查看、编辑或 diff。" />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
      {activeModal === 'memory' && (
        <WorkbenchActionModal title="新增记忆" description="把项目偏好、事实或修正记录写入当前工作区。用途更偏白盒记忆，独立知识库请在左侧知识库页面维护。" onClose={closeModal} onSubmit={() => void submitMemory()}>
          <FormField label="标题">
            <Input value={memoryDraft.title} onChange={(event) => setMemoryDraft({ ...memoryDraft, title: event.target.value })} className={inputClasses} autoFocus />
          </FormField>
          <FormField label="内容">
            <textarea value={memoryDraft.content} onChange={(event) => setMemoryDraft({ ...memoryDraft, content: event.target.value })} className={`${inputClasses} min-h-28 w-full p-3`} />
          </FormField>
          <FormField label="可信度">
            <select value={memoryDraft.confidence} onChange={(event) => setMemoryDraft({ ...memoryDraft, confidence: event.target.value as typeof memoryDraft.confidence })} className={selectClasses}>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </FormField>
        </WorkbenchActionModal>
      )}
      {activeModal === 'task' && (
        <WorkbenchActionModal title="新增后台任务" description="创建一个 Always-on 任务，可手动运行，也可按频率自动交给绑定智能体处理。" onClose={closeModal} onSubmit={() => void submitTask()}>
          <FormField label="任务名称">
            <Input value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} className={inputClasses} autoFocus />
          </FormField>
          <FormField label="任务目标">
            <textarea value={taskDraft.objective} onChange={(event) => setTaskDraft({ ...taskDraft, objective: event.target.value })} className={`${inputClasses} min-h-28 w-full p-3`} />
          </FormField>
          <FormField label="执行频率">
            <select value={taskDraft.cadence} onChange={(event) => setTaskDraft({ ...taskDraft, cadence: event.target.value as AlwaysOnTask['cadence'] })} className={selectClasses}>
              <option value="manual">手动</option>
              <option value="hourly">每小时</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
            </select>
          </FormField>
        </WorkbenchActionModal>
      )}
      {activeModal === 'route' && (
        <WorkbenchActionModal title="新增路由规则" description="按关键词和模型策略，把任务分配给更合适的智能体。" onClose={closeModal} onSubmit={() => void submitRoute()}>
          <FormField label="规则名称">
            <Input value={routeDraft.name} onChange={(event) => setRouteDraft({ ...routeDraft, name: event.target.value })} className={inputClasses} autoFocus />
          </FormField>
          <FormField label="匹配关键词">
            <Input value={routeDraft.matcher} onChange={(event) => setRouteDraft({ ...routeDraft, matcher: event.target.value })} className={inputClasses} placeholder="例如：搜索,代码,总结" />
          </FormField>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="模型策略">
              <select value={routeDraft.preferredModelStrategy} onChange={(event) => setRouteDraft({ ...routeDraft, preferredModelStrategy: event.target.value as RoutingRule['preferredModelStrategy'] })} className={selectClasses}>
                <option value="fast">速度优先</option>
                <option value="balanced">均衡</option>
                <option value="quality">质量优先</option>
              </select>
            </FormField>
            <FormField label="目标智能体">
              <select value={routeDraft.targetAgentId} onChange={(event) => setRouteDraft({ ...routeDraft, targetAgentId: event.target.value })} className={selectClasses}>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                {agents.length === 0 && <option value="main">Main</option>}
              </select>
            </FormField>
          </div>
          <FormField label="说明">
            <textarea value={routeDraft.notes} onChange={(event) => setRouteDraft({ ...routeDraft, notes: event.target.value })} className={`${inputClasses} min-h-24 w-full p-3`} />
          </FormField>
        </WorkbenchActionModal>
      )}
      {activeModal === 'report' && (
        <WorkbenchActionModal title="生成运行报告" description="基于最新工作流记录生成报告草稿，也可以手动补充结论、文件和风险。" onClose={closeModal} onSubmit={() => void submitReport()}>
          <FormField label="报告标题">
            <Input value={reportDraft.title} onChange={(event) => setReportDraft({ ...reportDraft, title: event.target.value })} className={inputClasses} autoFocus />
          </FormField>
          <FormField label="报告内容">
            <textarea value={reportDraft.summary} onChange={(event) => setReportDraft({ ...reportDraft, summary: event.target.value })} className={`${inputClasses} min-h-40 w-full p-3`} />
          </FormField>
        </WorkbenchActionModal>
      )}
    </div>
  );
}

function WorkbenchActionModal({
  title,
  description,
  children,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <form
        className="w-full max-w-xl rounded-2xl border border-black/10 bg-background p-5 shadow-2xl dark:border-white/10"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            ×
          </Button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} className="rounded-full px-4">
            取消
          </Button>
          <Button type="submit" className="rounded-full px-4">
            保存
          </Button>
        </div>
      </form>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">{icon}{label}</div>
      <p className="text-3xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function CapabilityCard({ title, icon, actionLabel, onAction, children }: { title: string; icon: ReactNode; actionLabel: string; onAction: () => void; children: ReactNode }) {
  return (
    <Card className="rounded-2xl border-black/10 bg-transparent dark:border-white/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">{icon}{title}</CardTitle>
        <Button variant="outline" onClick={onAction} className="h-8 rounded-full px-3 text-xs">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {actionLabel}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function Row({ title, detail, onDelete }: { title: string; detail: string; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-black/5 p-3 dark:bg-white/5">
      <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button variant="ghost" size="icon" onClick={onDelete} className="h-7 w-7 text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="rounded-xl bg-black/5 p-4 text-sm text-muted-foreground dark:bg-white/5">{text}</p>;
}

function ActionTile({ icon, title, detail, action, onClick }: { icon: ReactNode; title: string; detail: string; action: string; onClick: () => void }) {
  return (
    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </div>
      <p className="mb-4 min-h-[44px] text-xs leading-5 text-muted-foreground">{detail}</p>
      <Button variant="outline" onClick={onClick} className="h-8 rounded-full px-3 text-xs">{action}</Button>
    </div>
  );
}

export default Workbench;
