/**
 * Update Settings Component
 * Displays update status and allows manual update checking/installation
 */
import { useEffect, useCallback, useState } from 'react';
import { Download, RefreshCw, Loader2, Rocket, XCircle, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useUpdateStore } from '@/stores/update';
import { useTranslation } from 'react-i18next';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

type UpdateDiagnostics = {
  checkedAt: number;
  ok: boolean;
  latestVersion?: string;
  releaseUrl?: string;
  assetNames: string[];
  latestYmlFound: boolean;
  exeFound: boolean;
  message: string;
};

export function UpdateSettings() {
  const { t } = useTranslation('settings');
  const {
    status,
    currentVersion,
    updateInfo,
    progress,
    error,
    isInitialized,
    autoInstallCountdown,
    init,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    cancelAutoInstall,
    clearError,
  } = useUpdateStore();
  const [diagnostics, setDiagnostics] = useState<UpdateDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  // Initialize on mount
  useEffect(() => {
    init();
  }, [init]);

  const handleCheckForUpdates = useCallback(async () => {
    clearError();
    await checkForUpdates();
  }, [checkForUpdates, clearError]);

  const handleRunDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    try {
      const response = await fetch('https://api.github.com/repos/boggshawkmendylihue1192-dotcom/Fclawx-custom/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        throw new Error(`GitHub Releases 返回 HTTP ${response.status}`);
      }
      const release = await response.json() as {
        tag_name?: string;
        html_url?: string;
        assets?: Array<{ name?: string }>;
      };
      const assetNames = (release.assets ?? []).map((asset) => asset.name || '').filter(Boolean);
      const latestYmlFound = assetNames.includes('latest.yml');
      const exeFound = assetNames.some((name) => /^ClawX-\d+\.\d+\.\d+-win-x64\.exe$/.test(name));
      const latestVersion = (release.tag_name || '').replace(/^v/, '');
      const ok = Boolean(latestVersion && latestYmlFound && exeFound);
      setDiagnostics({
        checkedAt: Date.now(),
        ok,
        latestVersion,
        releaseUrl: release.html_url,
        assetNames,
        latestYmlFound,
        exeFound,
        message: ok
          ? 'GitHub Release、Windows 安装包和 latest.yml 都存在。'
          : 'Release 附件不完整，软件内更新可能无法识别新版本。',
      });
    } catch (error) {
      setDiagnostics({
        checkedAt: Date.now(),
        ok: false,
        assetNames: [],
        latestYmlFound: false,
        exeFound: false,
        message: `诊断失败：${String(error)}`,
      });
    } finally {
      setDiagnosticsLoading(false);
    }
  }, []);

  const renderStatusIcon = () => {
    switch (status) {
      case 'checking':
      case 'downloading':
      case 'installing':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case 'available':
        return <Download className="h-4 w-4 text-primary" />;
      case 'downloaded':
        return <Rocket className="h-4 w-4 text-primary" />;
      case 'error':
        return <RefreshCw className="h-4 w-4 text-destructive" />;
      default:
        return <RefreshCw className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const renderStatusText = () => {
    if (status === 'downloaded' && autoInstallCountdown != null && autoInstallCountdown >= 0) {
      return t('updates.status.autoInstalling', { seconds: autoInstallCountdown });
    }
    switch (status) {
      case 'checking':
        return t('updates.status.checking');
      case 'downloading':
        return t('updates.status.downloading');
      case 'available':
        return t('updates.status.available', { version: updateInfo?.version });
      case 'downloaded':
        return t('updates.status.downloaded', { version: updateInfo?.version });
      case 'installing':
        return t('updates.status.installing', { defaultValue: '正在准备安装并重启...' });
      case 'error':
        return error || t('updates.status.failed');
      case 'not-available':
        return t('updates.status.latest');
      default:
        return t('updates.status.check');
    }
  };

  const renderAction = () => {
    switch (status) {
      case 'checking':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('updates.action.checking')}
          </Button>
        );
      case 'downloading':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('updates.action.downloading')}
          </Button>
        );
      case 'installing':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('updates.action.installing', { defaultValue: '正在安装...' })}
          </Button>
        );
      case 'available':
        return (
          <Button onClick={downloadUpdate} size="sm">
            <Download className="h-4 w-4 mr-2" />
            {t('updates.action.download')}
          </Button>
        );
      case 'downloaded':
        if (autoInstallCountdown != null && autoInstallCountdown >= 0) {
          return (
            <Button onClick={cancelAutoInstall} size="sm" variant="outline">
              <XCircle className="h-4 w-4 mr-2" />
              {t('updates.action.cancelAutoInstall')}
            </Button>
          );
        }
        return (
          <Button onClick={installUpdate} size="sm" variant="default">
            <Rocket className="h-4 w-4 mr-2" />
            {t('updates.action.install')}
          </Button>
        );
      case 'error':
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('updates.action.retry')}
          </Button>
        );
      default:
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('updates.action.check')}
          </Button>
        );
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current Version */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('updates.currentVersion')}</p>
          <p className="text-2xl font-bold">v{currentVersion}</p>
        </div>
        {renderStatusIcon()}
      </div>

      {/* Status */}
      <div className="flex items-center justify-between py-3 border-t border-b">
        <p className="text-sm text-muted-foreground">{renderStatusText()}</p>
        {renderAction()}
      </div>

      {/* Download Progress */}
      {status === 'downloading' && progress && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
            </span>
            <span>{formatBytes(progress.bytesPerSecond)}/s</span>
          </div>
          <Progress value={progress.percent} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            {Math.round(progress.percent)}% complete
          </p>
        </div>
      )}

      {/* Update Info */}
      {updateInfo && (status === 'available' || status === 'downloaded') && (
        <div className="rounded-lg bg-muted p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">Version {updateInfo.version}</p>
            {updateInfo.releaseDate && (
              <p className="text-sm text-muted-foreground">
                {new Date(updateInfo.releaseDate).toLocaleDateString()}
              </p>
            )}
          </div>
          {updateInfo.releaseNotes && (
            <div className="text-sm text-muted-foreground prose prose-sm max-w-none">
              <p className="font-medium text-foreground mb-1">{t('updates.whatsNew')}</p>
              <p className="whitespace-pre-wrap">{updateInfo.releaseNotes}</p>
            </div>
          )}
        </div>
      )}

      {/* Error Details */}
      {status === 'error' && error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/10 p-4 text-red-600 dark:text-red-400 text-sm">
          <p className="font-medium mb-1">{t('updates.errorDetails')}</p>
          <p>{error}</p>
        </div>
      )}

      {/* Help Text */}
      <p className="text-xs text-muted-foreground">
        {t('updates.help')}
      </p>

      <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">更新诊断</p>
            <p className="text-xs text-muted-foreground">检查 GitHub Release、latest.yml 和 Windows 安装包附件。</p>
          </div>
          <Button onClick={handleRunDiagnostics} disabled={diagnosticsLoading} variant="outline" size="sm">
            {diagnosticsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
            诊断
          </Button>
        </div>
        {diagnostics && (
          <div className={diagnostics.ok ? 'rounded-lg bg-green-500/10 p-3 text-xs text-green-700 dark:text-green-400' : 'rounded-lg bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400'}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{diagnostics.ok ? '更新源正常' : '更新源异常'}</span>
              <span className="text-current/70">{new Date(diagnostics.checkedAt).toLocaleTimeString()}</span>
            </div>
            <p className="mt-1">{diagnostics.message}</p>
            <div className="mt-2 grid gap-1 text-current/80">
              <span>当前版本：v{currentVersion}</span>
              <span>GitHub 最新：{diagnostics.latestVersion ? `v${diagnostics.latestVersion}` : '-'}</span>
              <span>latest.yml：{diagnostics.latestYmlFound ? '存在' : '缺失'}</span>
              <span>Windows exe：{diagnostics.exeFound ? '存在' : '缺失'}</span>
            </div>
            {diagnostics.releaseUrl && (
              <a className="mt-2 inline-flex text-current underline" href={diagnostics.releaseUrl} target="_blank" rel="noreferrer">
                打开 Release
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default UpdateSettings;
