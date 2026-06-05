/**
 * Chat Toolbar
 * Session selector, new session, refresh, and the workspace browser
 * entry point.  Rendered in the Header when on the Chat page.
 */
import { useEffect, useMemo } from 'react';
import { RefreshCw, Bot, FolderTree, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_BROWSER_ENABLED } from '@/components/file-preview/workspace-browser-config';

type ChatToolbarProps = {
  questionDirectoryOpen?: boolean;
  questionDirectoryCount?: number;
  onToggleQuestionDirectory?: () => void;
};

export function ChatToolbar({
  questionDirectoryOpen = false,
  questionDirectoryCount = 0,
  onToggleQuestionDirectory,
}: ChatToolbarProps = {}) {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const switchSession = useChatStore((s) => s.switchSession);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const openBrowser = useArtifactPanel((s) => s.openBrowser);
  const panelOpen = useArtifactPanel((s) => s.open);
  const panelTab = useArtifactPanel((s) => s.tab);
  const closePanel = useArtifactPanel((s) => s.close);
  const { t } = useTranslation('chat');
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = currentAgent?.name ?? currentAgentId;
  const selectableAgents = useMemo(() => {
    if ((agents ?? []).some((agent) => agent.id === currentAgentId)) return agents ?? [];
    return [
      ...agents,
      {
        id: currentAgentId,
        name: currentAgentName,
        isDefault: currentAgentId === 'main',
        modelDisplay: '',
        inheritedModel: true,
        workspace: '',
        agentDir: '',
        mainSessionKey: `agent:${currentAgentId || 'main'}:main`,
        channelTypes: [],
      },
    ];
  }, [agents, currentAgentId, currentAgentName]);

  useEffect(() => {
    if (agents.length === 0) {
      void fetchAgents();
    }
  }, [agents.length, fetchAgents]);

  const handleAgentChange = (agentId: string) => {
    if (!agentId || agentId === currentAgentId) return;
    const agent = selectableAgents.find((item) => item.id === agentId);
    const sessionKey = agent?.mainSessionKey || `agent:${agentId}:main`;
    switchSession(sessionKey);
  };

  const browserActive = WORKSPACE_BROWSER_ENABLED && panelOpen && panelTab === 'browser';
  const questionDirectoryAvailable = questionDirectoryCount > 1 && !!onToggleQuestionDirectory;

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-foreground/80 dark:border-white/10 dark:bg-white/5">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span className="whitespace-nowrap">{t('toolbar.currentAgent', { agent: '' }).trim()}</span>
        <Select
          value={currentAgentId}
          onChange={(event) => handleAgentChange(event.target.value)}
          disabled={loading || selectableAgents.length <= 1}
          aria-label={t('composer.pickAgent')}
          className="h-6 min-w-[96px] max-w-[180px] border-0 bg-transparent px-1 py-0 pr-6 text-xs font-semibold text-foreground shadow-none ring-offset-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          {selectableAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </Select>
      </div>
      {WORKSPACE_BROWSER_ENABLED && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                browserActive && 'bg-foreground/10 text-foreground',
              )}
              onClick={() => (browserActive ? closePanel() : openBrowser())}
              disabled={!currentAgent?.workspace}
              aria-label={t('toolbar.workspace', '工作空间')}
            >
              <FolderTree className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.workspace', '工作空间')}</p>
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="chat-question-directory-toggle"
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
              questionDirectoryOpen && 'bg-foreground/10 text-foreground',
            )}
            onClick={onToggleQuestionDirectory}
            disabled={!questionDirectoryAvailable}
            aria-label={t('questionDirectory.title')}
          >
            <ListTree className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('questionDirectory.title')}</p>
        </TooltipContent>
      </Tooltip>
      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            onClick={() => refresh()}
            disabled={loading}
            aria-label={t('toolbar.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
