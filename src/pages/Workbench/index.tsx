import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  Bot,
  Brain,
  Code2,
  FolderOpen,
  History,
  Layers,
  MemoryStick,
  Package,
  Play,
  Plus,
  RefreshCw,
  Route,
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
import { cn } from '@/lib/utils';
import type { AgentSummary } from '@/types/agent';
import type { WorkbenchProject } from '@/types/workbench';

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
    deleteAlwaysOnTask,
    saveRoutingRule,
    deleteRoutingRule,
    saveReport,
    deleteReport,
  } = useWorkbenchStore();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || projects[0] || null;

  useEffect(() => {
    hydrate();
    void Promise.all([fetchAgents(), fetchWorkflows()]);
  }, [fetchAgents, fetchWorkflows, hydrate]);

  useEffect(() => {
    if (!hydrated || projects.length > 0 || agents.length === 0) return;
    agents.forEach((agent) => saveProject(seedProjectFromAgent(agent)));
  }, [agents, hydrated, projects.length, saveProject]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

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

  const createMemory = () => {
    if (!selectedProject) return;
    const title = window.prompt('记忆标题');
    if (!title) return;
    const content = window.prompt('记忆内容');
    saveMemory({
      projectId: selectedProject.id,
      title,
      content: content || '',
      source: 'manual',
      confidence: 'medium',
      status: 'active',
    });
    toast.success('记忆已保存');
  };

  const createAlwaysOnTask = () => {
    if (!selectedProject) return;
    const title = window.prompt('后台任务名称');
    if (!title) return;
    const objective = window.prompt('任务目标');
    saveAlwaysOnTask({
      projectId: selectedProject.id,
      title,
      objective: objective || '',
      cadence: 'daily',
      status: 'active',
      nextRunHint: '可从工作流或定时任务继续接入自动执行。',
    });
    toast.success('后台任务已保存');
  };

  const createRoutingRule = () => {
    const name = window.prompt('路由规则名称');
    if (!name) return;
    const matcher = window.prompt('匹配关键词，例如：搜索,代码,总结');
    saveRoutingRule({
      name,
      matcher: matcher || '',
      complexity: 'normal',
      preferredModelStrategy: 'balanced',
      targetAgentId: selectedProject?.agentId || agents[0]?.id || 'main',
      enabled: true,
    });
    toast.success('路由规则已保存');
  };

  const createReportFromLatestRun = () => {
    if (!selectedProject) return;
    const latest = runs[0];
    saveReport({
      projectId: selectedProject.id,
      title: latest ? `${latest.workflowName} 运行报告` : '手动运行报告',
      summary: latest
        ? `状态：${latest.status}\n步骤：${latest.stepCount}\n智能体：${latest.agentIds.join(', ')}\n会话：${latest.sessionKey || '无'}`
        : '暂无工作流记录，可手动补充本次任务的结论、文件和风险。',
      status: 'draft',
    });
    toast.success('报告已生成');
  };

  const runAlwaysOnTask = async (title: string, objective: string) => {
    if (!selectedProject) return;
    navigate('/');
    await sendMessage([
      `执行 Always-on 后台任务：${title}`,
      `项目：${selectedProject.name}`,
      `工作区：${selectedProject.workspace || '未配置'}`,
      '',
      '要求：',
      objective,
      '',
      '请输出进度、结果文件、下一步建议，并把可长期记忆的事实单独列出。',
    ].join('\n'), undefined, selectedProject.agentId);
  };

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
            <Button onClick={() => agents[0] && saveProject(seedProjectFromAgent(agents[0]))} className="h-9 rounded-full px-4">
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
                    <Input value={selectedProject.workspace} onChange={(event) => saveProject({ ...selectedProject, workspace: event.target.value })} className={inputClasses} />
                  </div>
                  <div className="space-y-2">
                    <Label>绑定智能体</Label>
                    <select value={selectedProject.agentId} onChange={(event) => saveProject({ ...selectedProject, agentId: event.target.value })} className={selectClasses}>
                      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button variant="outline" onClick={() => selectedProject.workspace && invokeIpc('shell:openPath', selectedProject.workspace)} className="h-[42px] flex-1 rounded-xl">
                      <FolderOpen className="mr-2 h-4 w-4" />
                      打开
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteProject(selectedProject.id)} className="h-[42px] w-[42px] rounded-xl text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <CapabilityCard title="白盒记忆管理" icon={<Brain className="h-5 w-5" />} actionLabel="新增记忆" onAction={createMemory}>
                {projectMemories.slice(0, 5).map((memory) => (
                  <Row key={memory.id} title={memory.title} detail={`${memory.confidence} · ${memory.source} · ${formatTime(memory.updatedAt)}`} onDelete={() => deleteMemory(memory.id)} />
                ))}
                {projectMemories.length === 0 && <EmptyText text="暂无记忆。可把重要偏好、项目事实、错误修正写入这里。" />}
              </CapabilityCard>

              <CapabilityCard title="Always-on 后台任务" icon={<Play className="h-5 w-5" />} actionLabel="新增任务" onAction={createAlwaysOnTask}>
                {projectTasks.slice(0, 5).map((task) => (
                  <div key={task.id} className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => void runAlwaysOnTask(task.title, task.objective)} className="h-7 w-7">
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteAlwaysOnTask(task.id)} className="h-7 w-7 text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.objective || task.nextRunHint}</p>
                  </div>
                ))}
                {projectTasks.length === 0 && <EmptyText text="暂无后台任务。可用于长期监控、定期总结、自动推进项目。" />}
              </CapabilityCard>

              <CapabilityCard title="智能模型路由" icon={<Route className="h-5 w-5" />} actionLabel="新增规则" onAction={createRoutingRule}>
                {routingRules.slice(0, 5).map((rule) => (
                  <Row key={rule.id} title={rule.name} detail={`${rule.matcher || '全部'} · ${rule.complexity} · ${rule.preferredModelStrategy} · ${agentName(agents, rule.targetAgentId)}`} onDelete={() => deleteRoutingRule(rule.id)} />
                ))}
                {routingRules.length === 0 && <EmptyText text="暂无路由规则。可以按关键词、复杂度和模型策略把任务分发给不同智能体。" />}
              </CapabilityCard>

              <CapabilityCard title="任务历史 / 运行报告" icon={<History className="h-5 w-5" />} actionLabel="生成报告" onAction={createReportFromLatestRun}>
                {projectReports.slice(0, 3).map((report) => (
                  <Row key={report.id} title={report.title} detail={`${report.status} · ${formatTime(report.createdAt)}`} onDelete={() => deleteReport(report.id)} />
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
              <ActionTile icon={<Code2 className="h-5 w-5" />} title="文件树 + Git + 代码工作区" detail="工作区文件浏览已在聊天右侧面板可用；Git/代码审查可由绑定智能体直接运行。" action="发起 Git 检查" onClick={() => selectedProject && void sendMessage(`检查工作区 Git 状态并总结代码风险：${selectedProject.workspace}`, undefined, selectedProject.agentId)} />
            </div>
          </div>
        </div>
      </div>
    </div>
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
