import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Gauge,
  Network,
  RefreshCw,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import type { UsageHistoryEntry } from '@/pages/Models/usage-history';
import { toast } from 'sonner';

interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error';
  statusReason?: string;
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error';
  statusReason?: string;
  accounts: ChannelAccountItem[];
}

interface GatewayHealthSummary {
  state?: 'healthy' | 'degraded' | 'unresponsive';
  reasons?: string[];
  consecutiveHeartbeatMisses?: number;
  consecutiveRpcFailures?: number;
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
}

interface GatewayDiagnosticSnapshot {
  capturedAt: number;
  platform: string;
  gateway: GatewayHealthSummary & Record<string, unknown>;
  channels: ChannelGroupItem[];
  clawxLogTail: string;
  gatewayLogTail: string;
  gatewayErrLogTail: string;
}

type RuntimeLoadState = 'idle' | 'loading' | 'ready' | 'error';

const CHANNEL_STATUS_LABELS: Record<ChannelAccountItem['status'], string> = {
  connected: '已连接',
  connecting: '连接中',
  degraded: '异常',
  disconnected: '未连接',
  error: '错误',
};

const GATEWAY_STATE_LABELS: Record<string, string> = {
  running: '运行中',
  starting: '启动中',
  reconnecting: '重连中',
  stopped: '已停止',
  error: '错误',
};

function isGatewayDiagnosticSnapshot(value: unknown): value is GatewayDiagnosticSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.capturedAt === 'number'
    && typeof snapshot.platform === 'string'
    && typeof snapshot.gateway === 'object'
    && snapshot.gateway !== null
    && Array.isArray(snapshot.channels)
    && typeof snapshot.clawxLogTail === 'string'
    && typeof snapshot.gatewayLogTail === 'string'
    && typeof snapshot.gatewayErrLogTail === 'string'
  );
}

function formatTime(value?: number | string): string {
  if (value == null) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '暂无';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours} 小时 ${minutes % 60} 分钟`;
  if (minutes > 0) return `${minutes} 分钟 ${seconds % 60} 秒`;
  return `${seconds} 秒`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value));
}

function statusVariant(status: string | undefined): BadgeProps['variant'] {
  if (status === 'connected' || status === 'healthy' || status === 'running') return 'success';
  if (status === 'connecting' || status === 'starting' || status === 'reconnecting' || status === 'degraded') return 'warning';
  if (status === 'error' || status === 'unresponsive') return 'destructive';
  return 'secondary';
}

function pickLatestLogLine(text: string | undefined): string {
  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? '暂无';
}

function summarizeUsage(entries: UsageHistoryEntry[]) {
  const totals = entries.reduce(
    (acc, entry) => {
      acc.tokens += entry.totalTokens || 0;
      acc.input += entry.inputTokens || 0;
      acc.output += entry.outputTokens || 0;
      acc.cost += entry.costUsd || 0;
      return acc;
    },
    { tokens: 0, input: 0, output: 0, cost: 0 },
  );

  const byModel = new Map<string, number>();
  for (const entry of entries) {
    const model = entry.model || 'Unknown';
    byModel.set(model, (byModel.get(model) ?? 0) + (entry.totalTokens || 0));
  }

  const topModels = Array.from(byModel.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return { totals, topModels };
}

function summarizeUsageProviders(entries: UsageHistoryEntry[]) {
  const byProvider = new Map<string, { count: number; tokens: number; errors: number }>();
  for (const entry of entries) {
    const provider = entry.provider || 'Unknown';
    const current = byProvider.get(provider) ?? { count: 0, tokens: 0, errors: 0 };
    current.count += 1;
    current.tokens += entry.totalTokens || 0;
    if (entry.usageStatus === 'error') current.errors += 1;
    byProvider.set(provider, current);
  }
  return Array.from(byProvider.entries())
    .map(([provider, value]) => ({ provider, ...value }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);
}

function buildRuntimeFindings(input: {
  gatewayStatus: string;
  gatewayReady?: boolean;
  healthState: string | undefined;
  gatewayReasons: string[];
  channelCounts: Record<ChannelAccountItem['status'] | 'total', number>;
  usageHistory: UsageHistoryEntry[];
  gatewaySummary?: GatewayHealthSummary;
}): string[] {
  const findings: string[] = [];
  const { gatewayStatus, gatewayReady, healthState, gatewayReasons, channelCounts, usageHistory, gatewaySummary } = input;

  if (gatewayStatus !== 'running') {
    findings.push('网关未运行，聊天会卡在连接或发送前。');
  } else if (!gatewayReady) {
    findings.push('网关进程已启动，但 RPC 还没就绪，首次请求可能变慢。');
  }

  if (healthState && healthState !== 'healthy') {
    findings.push(`网关健康状态为 ${healthState}，建议先看诊断原因和日志。`);
  }
  if ((gatewaySummary?.consecutiveHeartbeatMisses ?? 0) > 0) {
    findings.push('检测到心跳丢失，可能是本地进程忙、网络代理或网关阻塞。');
  }
  if ((gatewaySummary?.consecutiveRpcFailures ?? 0) > 0) {
    findings.push(`连续 RPC 失败 ${gatewaySummary?.consecutiveRpcFailures} 次，优先检查 provider/OAuth/API Key。`);
  }
  if (channelCounts.degraded + channelCounts.error > 0) {
    findings.push('存在异常通道账号，消息平台转发可能影响整体响应。');
  }
  if (usageHistory.some((entry) => entry.usageStatus === 'error')) {
    findings.push('最近用量记录里出现模型计量错误，可能与 provider 响应或模型返回格式有关。');
  }
  if (gatewayReasons.some((reason) => /dns|name|resolve|network|timeout/i.test(reason))) {
    findings.push('诊断原因里出现网络/DNS/超时信号，回复慢可能和线路稳定性有关。');
  }

  if (findings.length === 0) {
    findings.push('当前运行态没有明显本地异常，回复慢更可能来自模型服务端排队、上下文长度或工具执行。');
  }
  return findings;
}

function buildRuntimeReport(input: {
  snapshot: GatewayDiagnosticSnapshot | null;
  usageHistory: UsageHistoryEntry[];
  gatewayStatus: ReturnType<typeof useGatewayStore.getState>['status'];
  healthState: string | undefined;
  gatewayReasons: string[];
  channelCounts: Record<ChannelAccountItem['status'] | 'total', number>;
  findings: string[];
}): string {
  const { snapshot, usageHistory, gatewayStatus, healthState, gatewayReasons, channelCounts, findings } = input;
  const usageSummary = summarizeUsage(usageHistory);
  const providers = summarizeUsageProviders(usageHistory);
  return [
    'ClawX 运行诊断报告',
    `时间: ${new Date().toLocaleString()}`,
    `Gateway: ${gatewayStatus.state} / ${gatewayStatus.gatewayReady ? 'ready' : 'not-ready'}`,
    `PID: ${gatewayStatus.pid ?? 'unknown'}`,
    `端口: ${gatewayStatus.port || 'unknown'}`,
    `运行时间: ${formatDuration(gatewayStatus.uptime)}`,
    `健康: ${healthState ?? 'unknown'}`,
    `通道: connected=${channelCounts.connected}, degraded=${channelCounts.degraded}, error=${channelCounts.error}, total=${channelCounts.total}`,
    `最近用量: records=${usageHistory.length}, tokens=${usageSummary.totals.tokens}, cost=$${usageSummary.totals.cost.toFixed(4)}`,
    `Provider: ${providers.map((item) => `${item.provider}:${item.tokens}/${item.count}`).join(', ') || '-'}`,
    `诊断原因: ${gatewayReasons.join(', ') || '-'}`,
    '判断:',
    ...findings.map((finding) => `- ${finding}`),
    '最新 Gateway 错误:',
    pickLatestLogLine(snapshot?.gatewayErrLogTail),
  ].join('\n');
}

function countChannelStatuses(channels: ChannelGroupItem[]) {
  return channels.reduce(
    (acc, group) => {
      acc.total += group.accounts.length || 1;
      const accounts = group.accounts.length > 0 ? group.accounts : [{ status: group.status }];
      for (const account of accounts) {
        acc[account.status] = (acc[account.status] ?? 0) + 1;
      }
      return acc;
    },
    {
      total: 0,
      connected: 0,
      connecting: 0,
      degraded: 0,
      disconnected: 0,
      error: 0,
    } as Record<ChannelAccountItem['status'] | 'total', number>,
  );
}

function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" strokeWidth={2} />
        <span>{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-normal">{value}</div>
      {detail && <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: typeof Activity;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Runtime() {
  const gatewayStatus = useGatewayStore((state) => state.status);
  const gatewayHealth = useGatewayStore((state) => state.health);
  const [snapshot, setSnapshot] = useState<GatewayDiagnosticSnapshot | null>(null);
  const [usageHistory, setUsageHistory] = useState<UsageHistoryEntry[]>([]);
  const [loadState, setLoadState] = useState<RuntimeLoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoadState((current) => (current === 'ready' ? 'loading' : 'loading'));
    setError(null);

    try {
      const [diagnostics, usage] = await Promise.all([
        hostApiFetch<unknown>('/api/diagnostics/gateway-snapshot'),
        hostApiFetch<UsageHistoryEntry[]>('/api/usage/recent-token-history?limit=120'),
      ]);

      if (isGatewayDiagnosticSnapshot(diagnostics)) {
        setSnapshot(diagnostics);
      } else {
        setSnapshot(null);
      }
      setUsageHistory(Array.isArray(usage) ? usage : []);
      setLastUpdatedAt(Date.now());
      setLoadState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    const initialRefreshTimer = window.setTimeout(() => {
      void refresh();
    }, 0);
    const timer = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => {
      window.clearTimeout(initialRefreshTimer);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const channelCounts = useMemo(() => countChannelStatuses(snapshot?.channels ?? []), [snapshot?.channels]);
  const usageSummary = useMemo(() => summarizeUsage(usageHistory), [usageHistory]);
  const providerSummary = useMemo(() => summarizeUsageProviders(usageHistory), [usageHistory]);
  const gatewaySummary = snapshot?.gateway;
  const healthState = gatewaySummary?.state ?? (gatewayHealth?.ok ? 'healthy' : 'degraded');
  const gatewayStateLabel = GATEWAY_STATE_LABELS[gatewayStatus.state] ?? gatewayStatus.state;
  const gatewayReasons = useMemo(
    () => gatewaySummary?.reasons ?? (gatewayHealth?.error ? [gatewayHealth.error] : []),
    [gatewayHealth, gatewaySummary?.reasons],
  );
  const runtimeFindings = useMemo(() => buildRuntimeFindings({
    gatewayStatus: gatewayStatus.state,
    gatewayReady: gatewayStatus.gatewayReady,
    healthState,
    gatewayReasons,
    channelCounts,
    usageHistory,
    gatewaySummary,
  }), [channelCounts, gatewayReasons, gatewayStatus.gatewayReady, gatewayStatus.state, gatewaySummary, healthState, usageHistory]);

  const copyRuntimeReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildRuntimeReport({
        snapshot,
        usageHistory,
        gatewayStatus,
        healthState,
        gatewayReasons,
        channelCounts,
        findings: runtimeFindings,
      }));
      toast.success('运行诊断报告已复制');
    } catch (copyError) {
      toast.error(`复制失败：${String(copyError)}`);
    }
  }, [channelCounts, gatewayReasons, gatewayStatus, healthState, runtimeFindings, snapshot, usageHistory]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-normal">运行概览</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            最近刷新：{lastUpdatedAt ? formatTime(lastUpdatedAt) : '暂无'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void copyRuntimeReport()}>
            <Copy className="mr-2 h-4 w-4" strokeWidth={2} />
            ????
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loadState === 'loading'}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loadState === 'loading' && 'animate-spin')} strokeWidth={2} />
            刷新
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="网关状态"
            value={gatewayStateLabel}
            detail={`PID ${gatewayStatus.pid ?? '暂无'} · 端口 ${gatewayStatus.port || '暂无'}`}
            icon={Server}
          />
          <MetricTile
            label="运行时间"
            value={formatDuration(gatewayStatus.uptime)}
            detail={gatewayStatus.connectedAt ? `连接于 ${formatTime(gatewayStatus.connectedAt)}` : '等待连接'}
            icon={Clock}
          />
          <MetricTile
            label="通道账号"
            value={`${channelCounts.connected}/${channelCounts.total}`}
            detail={`异常 ${channelCounts.degraded + channelCounts.error} · 未连接 ${channelCounts.disconnected}`}
            icon={Network}
          />
          <MetricTile
            label="最近用量"
            value={formatNumber(usageSummary.totals.tokens)}
            detail={`${usageHistory.length} 条记录 · $${usageSummary.totals.cost.toFixed(4)}`}
            icon={Gauge}
          />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.65fr)]">
          <Section title="性能判断" icon={Gauge}>
            <div className="space-y-2">
              {runtimeFindings.map((finding) => (
                <div key={finding} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{finding}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Provider 分布" icon={Server}>
            <div className="space-y-3">
              {providerSummary.length > 0 ? providerSummary.map((item) => (
                <div key={item.provider}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{item.provider}</span>
                    <span className="text-muted-foreground">{formatNumber(item.tokens)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{item.count} 次请求</span>
                    <span>{item.errors > 0 ? `${item.errors} 次计量异常` : '计量正常'}</span>
                  </div>
                </div>
              )) : <div className="text-sm text-muted-foreground">暂无 Provider 用量</div>}
            </div>
          </Section>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <Section title="网关健康" icon={Activity}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(gatewayStatus.state)}>{gatewayStateLabel}</Badge>
              <Badge variant={statusVariant(healthState)}>{healthState === 'healthy' ? '健康' : healthState}</Badge>
              <Badge variant={gatewayStatus.gatewayReady ? 'success' : 'warning'}>
                {gatewayStatus.gatewayReady ? 'RPC 就绪' : 'RPC 等待中'}
              </Badge>
            </div>

            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">最后存活</div>
                <div className="mt-1 font-medium">{formatTime(gatewaySummary?.lastAliveAt)}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">最后 RPC 成功</div>
                <div className="mt-1 font-medium">{formatTime(gatewaySummary?.lastRpcSuccessAt)}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">连续心跳丢失</div>
                <div className="mt-1 font-medium">{gatewaySummary?.consecutiveHeartbeatMisses ?? 0}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">连续 RPC 失败</div>
                <div className="mt-1 font-medium">{gatewaySummary?.consecutiveRpcFailures ?? 0}</div>
              </div>
            </div>

            <div className="mt-4 rounded-lg border bg-background p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {gatewayReasons.length > 0 ? (
                  <AlertTriangle className="h-4 w-4 text-yellow-600" strokeWidth={2} />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600" strokeWidth={2} />
                )}
                诊断原因
              </div>
              <div className="space-y-1 text-sm">
                {gatewayReasons.length > 0 ? gatewayReasons.map((reason) => (
                  <div key={reason} className="break-all text-muted-foreground">{reason}</div>
                )) : <div className="text-muted-foreground">暂无异常</div>}
              </div>
            </div>
          </Section>

          <Section title="最近模型用量" icon={Gauge}>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">输入</div>
                <div className="mt-1 font-semibold">{formatNumber(usageSummary.totals.input)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">输出</div>
                <div className="mt-1 font-semibold">{formatNumber(usageSummary.totals.output)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">成本</div>
                <div className="mt-1 font-semibold">${usageSummary.totals.cost.toFixed(4)}</div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {usageSummary.topModels.length > 0 ? usageSummary.topModels.map(([model, tokens]) => (
                <div key={model}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{model}</span>
                    <span className="text-muted-foreground">{formatNumber(tokens)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(6, Math.min(100, (tokens / Math.max(usageSummary.totals.tokens, 1)) * 100))}%` }}
                    />
                  </div>
                </div>
              )) : <div className="text-sm text-muted-foreground">暂无用量记录</div>}
            </div>
          </Section>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Section title="通道状态" icon={Network}>
            <div className="space-y-3">
              {(snapshot?.channels ?? []).length > 0 ? snapshot?.channels.map((channel) => (
                <div key={channel.channelType} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{channel.channelType}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {channel.accounts.length} 个账号 · 默认 {channel.defaultAccountId || '暂无'}
                    </div>
                  </div>
                  <Badge variant={statusVariant(channel.status)}>
                    {CHANNEL_STATUS_LABELS[channel.status] ?? channel.status}
                  </Badge>
                </div>
              )) : <div className="text-sm text-muted-foreground">暂无通道数据</div>}
            </div>
          </Section>

          <Section title="日志快照" icon={AlertTriangle}>
            <div className="space-y-3 text-sm">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Gateway 错误</div>
                <div className="break-all rounded-lg bg-muted/50 p-3 font-mono text-xs">{pickLatestLogLine(snapshot?.gatewayErrLogTail)}</div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Gateway 最新</div>
                <div className="break-all rounded-lg bg-muted/50 p-3 font-mono text-xs">{pickLatestLogLine(snapshot?.gatewayLogTail)}</div>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">ClawX 最新</div>
                <div className="break-all rounded-lg bg-muted/50 p-3 font-mono text-xs">{pickLatestLogLine(snapshot?.clawxLogTail)}</div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
