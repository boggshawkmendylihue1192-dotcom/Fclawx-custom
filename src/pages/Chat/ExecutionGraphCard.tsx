import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  Link,
  MessageSquare,
  Pencil,
  Search,
  Terminal,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import type { TaskStep } from './task-visualization';

interface ExecutionGraphCardProps {
  agentLabel: string;
  steps: TaskStep[];
  active: boolean;
  /** Hide the trailing "Thinking ..." indicator even when active. */
  suppressThinking?: boolean;
  /**
   * When provided, the card becomes fully controlled: the parent owns the
   * expand state (e.g. to persist across remounts) and toggling goes through
   * `onExpandedChange`. When omitted, the card manages its own local state.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

const TOOL_ROW_EXTRA_INDENT_PX = 8;

interface DelegationBoardItem {
  agentId: string;
  status: TaskStep['status'];
  spawnCount: number;
  yieldCount: number;
  latestTask?: string;
  sessionKey?: string;
}

function AnimatedDots({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-0.5 leading-none text-muted-foreground', className)} aria-hidden="true">
      <span className="inline-block animate-bounce [animation-delay:0ms]">.</span>
      <span className="inline-block animate-bounce [animation-delay:150ms]">.</span>
      <span className="inline-block animate-bounce [animation-delay:300ms]">.</span>
    </span>
  );
}

function GraphStatusIcon({ status }: { status: TaskStep['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4" />;
  if (status === 'error') return <XCircle className="h-4 w-4" />;
  return <CircleDashed className="h-4 w-4" />;
}

function StepIcon({ step }: { step: TaskStep }) {
  if (step.kind === 'thinking' || step.kind === 'message') return <MessageSquare className="h-3.5 w-3.5" />;
  if (step.phase === 'delegate') return <Users className="h-3.5 w-3.5" />;
  if (step.phase === 'search') return <Search className="h-3.5 w-3.5" />;
  if (step.phase === 'read') return <FileText className="h-3.5 w-3.5" />;
  if (step.phase === 'write') return <Pencil className="h-3.5 w-3.5" />;
  if (step.phase === 'terminal') return <Terminal className="h-3.5 w-3.5" />;
  if (step.kind === 'tool') return <Wrench className="h-3.5 w-3.5" />;
  return <GraphStatusIcon status={step.status} />;
}

function stepPhaseLabelKey(phase: TaskStep['phase']): string | null {
  if (!phase || phase === 'tool') return null;
  return `executionGraph.phase.${phase}`;
}

function buildDelegationBoard(steps: TaskStep[]): DelegationBoardItem[] {
  const board = new Map<string, DelegationBoardItem>();
  for (const step of steps) {
    if (step.phase !== 'delegate') continue;
    const agentId = step.targetAgentId || 'subagent';
    const item = board.get(agentId) ?? {
      agentId,
      status: 'running' as TaskStep['status'],
      spawnCount: 0,
      yieldCount: 0,
      latestTask: undefined,
      sessionKey: step.sessionKey,
    };

    if (/sessions_spawn|spawn|subagent|delegate/i.test(step.label)) {
      item.spawnCount += 1;
      item.latestTask = step.taskPreview || item.latestTask;
      item.sessionKey = step.sessionKey || item.sessionKey;
      item.status = step.status === 'error' ? 'error' : item.status;
    }
    if (/sessions_yield|yield/i.test(step.label)) {
      item.yieldCount += 1;
      item.status = step.status === 'error' ? 'error' : 'completed';
    }
    if (step.kind === 'system' && step.status === 'completed' && item.status !== 'error') {
      item.status = 'completed';
      item.sessionKey = step.sessionKey || step.detail || item.sessionKey;
    }
    board.set(agentId, item);
  }
  return [...board.values()];
}

function DelegationBoard({ items, active }: { items: DelegationBoardItem[]; active: boolean }) {
  const navigate = useNavigate();
  const switchSession = useChatStore((state) => state.switchSession);
  const abortRun = useChatStore((state) => state.abortRun);
  if (items.length === 0) return null;
  const completed = items.filter((item) => item.status === 'completed').length;
  const failed = items.filter((item) => item.status === 'error').length;
  const running = Math.max(0, items.length - completed - failed);

  return (
    <div className="ml-8 mt-2 rounded-xl border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4" />
          并行智能体看板
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>运行 {active ? running : Math.max(0, running)}</span>
          <span>完成 {completed}</span>
          <span>失败 {failed}</span>
          {active && (
            <button
              type="button"
              onClick={() => void abortRun()}
              className="rounded-full bg-black/5 px-2 py-0.5 hover:text-foreground dark:bg-white/10"
            >
              停止本轮
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.agentId} className="rounded-lg border border-black/10 bg-white/40 p-2 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2">
                <GraphStatusIcon status={item.status} />
                <span className="truncate text-sm font-medium text-foreground">@{item.agentId}</span>
              </div>
              <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-2xs text-muted-foreground dark:bg-white/10">
                {item.status === 'completed' ? '完成' : item.status === 'error' ? '失败' : '运行中'}
              </span>
            </div>
            {item.latestTask && (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.latestTask}</p>
            )}
            <div className="mt-2 flex items-center gap-3 text-2xs text-muted-foreground">
              <span>spawn {item.spawnCount}</span>
              <span>yield {item.yieldCount}</span>
              {item.status === 'running' && <Clock className="h-3 w-3" />}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(item.latestTask || `@${item.agentId}`);
                  toast.success('子任务已复制');
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-black/5 px-2 text-xs text-muted-foreground hover:text-foreground dark:bg-white/10"
              >
                <Copy className="h-3 w-3" />
                复制
              </button>
              <button
                type="button"
                disabled={!item.sessionKey}
                onClick={() => {
                  if (!item.sessionKey) return;
                  switchSession(item.sessionKey);
                  navigate('/');
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-black/5 px-2 text-xs text-muted-foreground enabled:hover:text-foreground disabled:opacity-40 dark:bg-white/10"
                title={item.sessionKey}
              >
                <ExternalLink className="h-3 w-3" />
                记录
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepDetailCard({ step }: { step: TaskStep }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!step.detail;
  // Narration steps (intermediate pure-text assistant messages folded from
  // the chat stream) are rendered without a label/status pill: the message
  // text IS the primary content.
  const isNarration = step.kind === 'message';
  const isTool = step.kind === 'tool';
  const isThinking = step.kind === 'thinking';
  const displayToolLabel = isTool && step.label === 'image_generate'
    ? t('executionGraph.imageGenerateLabel')
    : step.label;
  // System steps (subagent branch roots etc.) share the tool row layout:
  // bold label + truncated single-line detail preview + click-to-expand,
  // i.e. no rounded card / no separate detail line below the title.
  const isSystem = step.kind === 'system';
  const isFlatRow = isTool || isSystem;
  const showRunningDots = (isTool || isThinking) && step.status === 'running';
  const hideStatusText = (isTool || isSystem) && step.status === 'completed';
  const delegationPreview = step.targetAgentId
    ? `@${step.targetAgentId}${step.taskPreview ? ` · ${step.taskPreview}` : ''}`
    : undefined;
  const detailPreview = delegationPreview ?? step.detail?.replace(/\s+/g, ' ').trim();
  const canExpand = hasDetail;
  const displayLabel = isThinking ? t('executionGraph.thinkingLabel') : (isTool ? displayToolLabel : step.label);
  const phaseLabelKey = stepPhaseLabelKey(step.phase);

  return (
    <div
      className={cn(
        'min-w-0 flex-1 text-muted-foreground',
        isFlatRow || isNarration || isThinking
          ? 'px-0 py-0'
          : 'rounded-xl border border-black/10 bg-white/40 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex w-full gap-2 text-left',
          isFlatRow ? 'items-center' : 'items-start',
          canExpand ? 'cursor-pointer' : 'cursor-default',
        )}
        onClick={() => {
          if (!canExpand) return;
          setExpanded((value) => !value);
        }}
      >
        <div className="min-w-0 flex-1">
          {(!isNarration && !isThinking || expanded) && (
            <div className="flex min-w-0 items-center gap-2">
              <p className="shrink-0 text-sm font-medium text-muted-foreground">{displayLabel}</p>
              {isTool && step.label === 'web_fetch' && step.url && (
                <a
                  href={step.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title={step.url}
                >
                  <Link className="h-3.5 w-3.5" />
                </a>
              )}
              {isFlatRow && detailPreview && !expanded && (
                <p className="min-w-0 truncate text-xs leading-4 text-muted-foreground/80">
                  {detailPreview}
                </p>
              )}
              {phaseLabelKey && (
                <span className="shrink-0 whitespace-nowrap rounded-full bg-black/5 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground dark:bg-white/10">
                  {t(phaseLabelKey)}
                </span>
              )}
              {!hideStatusText && !showRunningDots && (
                <span className="shrink-0 whitespace-nowrap rounded-full bg-black/5 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground dark:bg-white/10">
                  {t(`taskPanel.stepStatus.${step.status}`)}
                </span>
              )}
              {showRunningDots && (
                <AnimatedDots className="text-sm" />
              )}
              {step.depth > 1 && (
                <span className="shrink-0 whitespace-nowrap rounded-full bg-black/5 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground dark:bg-white/10">
                  {t('executionGraph.branchLabel')}
                </span>
              )}
            </div>
          )}
          {step.detail && !expanded && !isFlatRow && (
            <p
              className={cn(
                'text-muted-foreground',
                isThinking
                  ? 'mt-0.5 text-meta leading-5 line-clamp-2'
                  : 'text-meta leading-6 text-muted-foreground line-clamp-2',
              )}
            >
              {step.detail}
            </p>
          )}
        </div>
        {canExpand && (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        )}
      </button>
      {step.detail && expanded && canExpand && isFlatRow && (() => {
            // Tool inputs are typically JSON; system payloads (e.g. subagent
            // session keys) are usually plain strings. Pretty-print if the
            // detail parses as JSON, otherwise fall back to the raw text so
            // session keys render unchanged.
            let formatted = step.detail;
            try {
              formatted = JSON.stringify(JSON.parse(step.detail), null, 2);
            } catch { /* not valid JSON */ }
            return (
              <div className="mt-3 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                <pre
                  className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground"
                >
                  {formatted}
                </pre>
              </div>
            );
          })()}
          {step.detail && expanded && canExpand && (isNarration || isThinking) && (
            <div className="mt-3 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
              <pre
                className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground"
              >
                {step.detail}
              </pre>
            </div>
          )}
    </div>
  );
}

export function ExecutionGraphCard({
  agentLabel,
  steps,
  active,
  suppressThinking = false,
  expanded: controlledExpanded,
  onExpandedChange,
}: ExecutionGraphCardProps) {
  const { t } = useTranslation('chat');

  // Active runs should stay expanded by default so the user can follow the
  // execution live. Once the run completes, the default state returns to
  // collapsed. Explicit user toggles remain controlled by the parent override.
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(active);
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (controlledExpanded == null && uncontrolledExpanded !== active) {
      setUncontrolledExpanded(active);
    }
  }

  const isControlled = controlledExpanded != null;
  const expanded = isControlled ? controlledExpanded : uncontrolledExpanded;
  const setExpanded = (next: boolean) => {
    if (!isControlled) setUncontrolledExpanded(next);
    onExpandedChange?.(next);
  };

  const toolCount = steps.filter((step) => step.kind === 'tool').length;
  const delegateCount = steps.filter((step) => step.phase === 'delegate').length;
  const processCount = steps.length - toolCount;
  const shouldShowTrailingThinking = active && !suppressThinking;
  const delegationBoardItems = buildDelegationBoard(steps);

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="chat-execution-graph"
        data-collapsed="true"
        onClick={() => setExpanded(true)}
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-muted-foreground dark:hover:bg-white/5"
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        <span className="truncate">
          {t('executionGraph.collapsedSummary', { toolCount, processCount, delegateCount })}
        </span>
      </button>
    );
  }

  return (
    <div
      data-testid="chat-execution-graph"
      data-collapsed="false"
      className="w-full px-0 py-0 text-muted-foreground"
    >
      <button
        type="button"
        data-testid="chat-execution-graph-collapse"
        onClick={() => setExpanded(false)}
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-muted-foreground dark:hover:bg-white/5"
        aria-label={t('executionGraph.collapseAction')}
        title={t('executionGraph.collapseAction')}
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90" />
        <span className="truncate">{t('executionGraph.title')}</span>
      </button>

      <div className="mt-0 px-0 py-0">
        <div className="mt-0.5 flex items-center gap-0.5" style={{ marginLeft: `${TOOL_ROW_EXTRA_INDENT_PX}px` }}>
          <div className="flex w-6 shrink-0 justify-center">
            <div className="flex h-6 w-6 items-center justify-center text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="truncate text-sm font-medium text-muted-foreground">
              {t('executionGraph.agentRun', { agent: agentLabel })}
            </span>
          </div>
        </div>

        <DelegationBoard items={delegationBoardItems} active={active} />

        {steps.map((step) => {
          const alignedIndentOffset = (
            step.kind === 'tool'
            || step.kind === 'message'
            || step.kind === 'thinking'
          ) ? TOOL_ROW_EXTRA_INDENT_PX : 0;
          const rowMarginLeft = (Math.max(step.depth - 1, 0) * 24) + alignedIndentOffset;
          return (
          <div key={step.id} className="mt-0.5">
            <div
              className="pl-3"
              style={{ marginLeft: `${rowMarginLeft}px` }}
            >
              <div className="ml-3 h-1 w-px bg-border" />
            </div>
            <div
              className="flex items-start gap-0.5"
              data-testid="chat-execution-step"
              style={{ marginLeft: `${rowMarginLeft}px` }}
            >
              <div className="flex w-6 shrink-0 justify-center">
                <div className="relative flex items-center justify-center">
                  {step.depth > 1 && (
                    <div className="absolute -left-3 top-1/2 h-px w-3 -translate-y-1/2 bg-border" />
                  )}
                  <div
                    className={cn(
                      'flex h-6 w-6 items-center justify-center text-muted-foreground',
                    )}
                  >
                    <StepIcon step={step} />
                  </div>
                </div>
              </div>
              <StepDetailCard step={step} />
            </div>
          </div>
        )})}
        {shouldShowTrailingThinking && (
          <div className="mt-0.5">
            <div className="pl-3" style={{ marginLeft: `${TOOL_ROW_EXTRA_INDENT_PX}px` }}>
              <div className="ml-3 h-1 w-px bg-border" />
            </div>
            <div
              className="flex items-center gap-0.5"
              data-testid="chat-execution-step-thinking-trailing"
              style={{ marginLeft: `${TOOL_ROW_EXTRA_INDENT_PX}px` }}
            >
              <div className="w-6 shrink-0" />
              <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                <span className="font-medium">{t('executionGraph.thinkingLabel')}</span>
                <AnimatedDots className="ml-1 inline-flex text-sm" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
