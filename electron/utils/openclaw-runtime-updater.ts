import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import { logger } from './logger';
import { resetOpenClawPluginDiscoveryCaches } from './openclaw-auth';
import {
  getActiveOpenClawRuntime,
  getBundledOpenClawDir,
  getOpenClawConfigDir,
  getOpenClawRuntimeRootDir,
  getOpenClawRuntimeStatePath,
  isOpenClawRuntimeDirUsable,
  isOpenClawRuntimeRefUsable,
  readOpenClawRuntimeState,
  type OpenClawRuntimeRef,
  type OpenClawRuntimeState,
} from './paths';

const NPM_REGISTRY_LATEST_URL = 'https://registry.npmjs.org/openclaw/latest';
const INSTALL_TIMEOUT_MS = 12 * 60_000;

let upgradeInFlight: Promise<OpenClawRuntimeOperationResult> | null = null;

export interface OpenClawRuntimeStatus {
  active: OpenClawRuntimeRef & { usable: boolean };
  bundled: OpenClawRuntimeRef & { usable: boolean };
  previous?: OpenClawRuntimeRef;
  statePath: string;
  rootDir: string;
  latestVersion?: string;
  canRollback: boolean;
}

export interface OpenClawRuntimeOperationResult {
  success: boolean;
  status: OpenClawRuntimeStatus;
  version?: string;
  backupConfigPath?: string;
  rolledBack?: boolean;
  error?: string;
}

interface NpmLatestResponse {
  version?: string;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readPackageVersion(dir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(dir, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version;
  } catch {
    return undefined;
  }
}

async function writeRuntimeState(state: OpenClawRuntimeState): Promise<void> {
  const statePath = getOpenClawRuntimeStatePath();
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

async function backupOpenClawConfig(): Promise<string | undefined> {
  const configPath = join(getOpenClawConfigDir(), 'openclaw.json');
  if (!existsSync(configPath)) return undefined;
  const backupDir = join(getOpenClawRuntimeRootDir(), 'backups', nowStamp());
  await mkdir(backupDir, { recursive: true });
  const backupPath = join(backupDir, 'openclaw.json');
  await copyFile(configPath, backupPath);
  return backupPath;
}

async function restoreOpenClawConfig(backupPath?: string): Promise<void> {
  if (!backupPath || !existsSync(backupPath)) return;
  const configPath = join(getOpenClawConfigDir(), 'openclaw.json');
  await mkdir(getOpenClawConfigDir(), { recursive: true });
  await copyFile(backupPath, configPath);
}

async function fetchLatestOpenClawVersion(): Promise<string> {
  const response = await fetch(NPM_REGISTRY_LATEST_URL);
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`);
  }
  const payload = await response.json() as NpmLatestResponse;
  if (!payload.version) {
    throw new Error('OpenClaw latest version not found in npm registry response');
  }
  return payload.version;
}

function getNpmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = INSTALL_TIMEOUT_MS,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      },
    });

    let output = '';
    const appendOutput = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 12000) {
        output = output.slice(-12000);
      }
    };

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(' ')}\n${output.trim()}`));
    });
  });
}

async function assertNpmAvailable(): Promise<void> {
  const rootDir = getOpenClawRuntimeRootDir();
  await mkdir(rootDir, { recursive: true });
  await runCommand(getNpmCommand(), ['--version'], rootDir, 20_000);
}

function versionInstallRoot(version: string): string {
  const suffix = createHash('sha1').update(`${version}:${Date.now()}`).digest('hex').slice(0, 8);
  return join(getOpenClawRuntimeRootDir(), 'versions', `${version}-${suffix}`);
}

async function installOpenClawRuntime(version: string): Promise<string> {
  const installRoot = versionInstallRoot(version);
  await rm(installRoot, { recursive: true, force: true });
  await mkdir(installRoot, { recursive: true });
  await runCommand(getNpmCommand(), [
    'install',
    `openclaw@${version}`,
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--prefer-online',
  ], installRoot);

  const packageDir = join(installRoot, 'node_modules', 'openclaw');
  if (!isOpenClawRuntimeDirUsable(packageDir)) {
    throw new Error(`Installed OpenClaw runtime is incomplete: ${packageDir}`);
  }
  return packageDir;
}

async function restartGateway(gatewayManager: GatewayManager): Promise<void> {
  await gatewayManager.restart();
}

export async function getOpenClawRuntimeStatus(options?: { fetchLatest?: boolean }): Promise<OpenClawRuntimeStatus> {
  const active = getActiveOpenClawRuntime();
  const bundledPath = getBundledOpenClawDir();
  const state = readOpenClawRuntimeState();
  const [activeVersion, bundledVersion, latestVersion] = await Promise.all([
    active.version ? Promise.resolve(active.version) : readPackageVersion(active.path),
    readPackageVersion(bundledPath),
    options?.fetchLatest ? fetchLatestOpenClawVersion().catch((error) => {
      logger.warn('Failed to fetch latest OpenClaw version:', error);
      return undefined;
    }) : Promise.resolve(undefined),
  ]);

  return {
    active: {
      ...active,
      version: activeVersion,
      usable: isOpenClawRuntimeDirUsable(active.path),
    },
    bundled: {
      type: 'bundled',
      path: bundledPath,
      version: bundledVersion,
      usable: isOpenClawRuntimeDirUsable(bundledPath),
    },
    previous: state.previous,
    statePath: getOpenClawRuntimeStatePath(),
    rootDir: getOpenClawRuntimeRootDir(),
    latestVersion,
    canRollback: Boolean(state.previous && isOpenClawRuntimeRefUsable(state.previous)),
  };
}

export async function checkOpenClawRuntimeUpdate(): Promise<OpenClawRuntimeStatus> {
  return await getOpenClawRuntimeStatus({ fetchLatest: true });
}

export async function upgradeOpenClawRuntime(
  gatewayManager: GatewayManager,
  requestedVersion?: string,
): Promise<OpenClawRuntimeOperationResult> {
  if (upgradeInFlight) return await upgradeInFlight;
  upgradeInFlight = (async () => {
    const previous = getActiveOpenClawRuntime();
    const version = requestedVersion?.trim() || await fetchLatestOpenClawVersion();
    let backupConfigPath: string | undefined;
    let gatewayStopped = false;
    let runtimeSwitched = false;

    try {
      logger.info(`[runtime-upgrade] Upgrading OpenClaw runtime to ${version}`);
      await assertNpmAvailable();
      backupConfigPath = await backupOpenClawConfig();
      await gatewayManager.stop();
      gatewayStopped = true;

      const runtimePath = await installOpenClawRuntime(version);
      const next: OpenClawRuntimeRef = {
        type: 'user',
        path: runtimePath,
        version,
        platform: process.platform,
        arch: process.arch,
        activatedAt: new Date().toISOString(),
        backupConfigPath,
      };
      await writeRuntimeState({
        active: next,
        previous,
        updatedAt: new Date().toISOString(),
      });
      runtimeSwitched = true;
      resetOpenClawPluginDiscoveryCaches();

      try {
        await restartGateway(gatewayManager);
      } catch (restartError) {
        await writeRuntimeState({
          active: previous.type === 'bundled' ? undefined : previous,
          previous: next,
          updatedAt: new Date().toISOString(),
        });
        resetOpenClawPluginDiscoveryCaches();
        await restoreOpenClawConfig(backupConfigPath);
        await restartGateway(gatewayManager).catch((error) => {
          logger.warn('[runtime-upgrade] Failed to restart previous runtime after rollback:', error);
        });
        throw new Error(`New runtime failed to start, rolled back: ${normalizeError(restartError)}`, {
          cause: restartError,
        });
      }

      return {
        success: true,
        version,
        backupConfigPath,
        status: await getOpenClawRuntimeStatus({ fetchLatest: true }),
      };
    } catch (error) {
      logger.error('[runtime-upgrade] Upgrade failed:', error);
      if (gatewayStopped && !runtimeSwitched) {
        await restoreOpenClawConfig(backupConfigPath).catch((restoreError) => {
          logger.warn('[runtime-upgrade] Failed to restore OpenClaw config after failed install:', restoreError);
        });
        await restartGateway(gatewayManager).catch((restartError) => {
          logger.warn('[runtime-upgrade] Failed to restart previous runtime after failed install:', restartError);
        });
      }
      return {
        success: false,
        version,
        backupConfigPath,
        rolledBack: true,
        error: normalizeError(error),
        status: await getOpenClawRuntimeStatus({ fetchLatest: true }),
      };
    } finally {
      upgradeInFlight = null;
    }
  })();
  return await upgradeInFlight;
}

export async function rollbackOpenClawRuntime(gatewayManager: GatewayManager): Promise<OpenClawRuntimeOperationResult> {
  const state = readOpenClawRuntimeState();
  const current = getActiveOpenClawRuntime();
  const previous = state.previous;

  if (!previous || !isOpenClawRuntimeRefUsable(previous)) {
    return {
      success: false,
      error: 'No usable previous OpenClaw runtime is available',
      status: await getOpenClawRuntimeStatus({ fetchLatest: true }),
    };
  }

  try {
    await gatewayManager.stop();
    await restoreOpenClawConfig(current.backupConfigPath);
    await writeRuntimeState({
      active: previous.type === 'bundled' ? undefined : previous,
      previous: current,
      updatedAt: new Date().toISOString(),
    });
    resetOpenClawPluginDiscoveryCaches();
    await restartGateway(gatewayManager);
    return {
      success: true,
      version: previous.version,
      status: await getOpenClawRuntimeStatus({ fetchLatest: true }),
    };
  } catch (error) {
    return {
      success: false,
      error: normalizeError(error),
      status: await getOpenClawRuntimeStatus({ fetchLatest: true }),
    };
  }
}

export function getRuntimeUpgradePrerequisiteHint(): string {
  return `需要本机可用 npm。当前用户目录: ${homedir()}`;
}
