import { execFile } from 'child_process';
import { readdir, readFile, stat, writeFile } from 'fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import { isAbsolute, join, relative, resolve } from 'path';
import { promisify } from 'util';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  deleteWorkbenchMemory,
  deleteWorkbenchProject,
  deleteWorkbenchReport,
  deleteWorkbenchRoutingRule,
  deleteWorkbenchTask,
  listWorkbenchSnapshot,
  markWorkbenchTaskRun,
  saveWorkbenchMemory,
  saveWorkbenchProject,
  saveWorkbenchReport,
  saveWorkbenchRoutingRule,
  saveWorkbenchTask,
  type AlwaysOnTask,
  type RoutingRule,
  type WorkbenchMemory,
  type WorkbenchProject,
  type WorkbenchReport,
} from '../../utils/workbench-config';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 512 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'release', '.next', 'build']);

function resolveWorkspacePath(workspace: string, childPath = ''): string {
  const root = resolve(workspace);
  const target = resolve(root, childPath || '.');
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path escapes workspace');
  }
  return target;
}

async function listTree(workspace: string, childPath = '', depth = 2): Promise<Array<{ path: string; name: string; type: 'file' | 'dir'; size?: number }>> {
  const root = resolve(workspace);
  const start = resolveWorkspacePath(root, childPath);
  const entries: Array<{ path: string; name: string; type: 'file' | 'dir'; size?: number }> = [];

  async function walk(dir: string, level: number): Promise<void> {
    const dirEntries = await readdir(dir, { withFileTypes: true });
    for (const entry of dirEntries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        entries.push({ path: rel, name: entry.name, type: 'dir' });
        if (level < depth) await walk(full, level + 1);
      } else if (entry.isFile()) {
        const info = await stat(full);
        entries.push({ path: rel, name: entry.name, type: 'file', size: info.size });
      }
      if (entries.length >= 500) return;
    }
  }

  await walk(start, 0);
  return entries;
}

async function readWorkspaceFile(workspace: string, filePath: string): Promise<{ path: string; content: string; size: number }> {
  const target = resolveWorkspacePath(workspace, filePath);
  const info = await stat(target);
  if (!info.isFile()) throw new Error('Not a file');
  if (info.size > MAX_FILE_BYTES) throw new Error('File is too large for inline editing');
  return { path: filePath, content: await readFile(target, 'utf-8'), size: info.size };
}

async function writeWorkspaceFile(workspace: string, filePath: string, content: string): Promise<{ path: string; size: number }> {
  const target = resolveWorkspacePath(workspace, filePath);
  const info = await stat(target);
  if (!info.isFile()) throw new Error('Only existing files can be edited from Workbench');
  await writeFile(target, content, 'utf-8');
  const next = await stat(target);
  return { path: filePath, size: next.size };
}

async function gitStatus(workspace: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', workspace, 'status', '--short', '--branch'], { timeout: 8000 });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleWorkbenchRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/workbench' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await listWorkbenchSnapshot()) });
    return true;
  }

  if (url.pathname === '/api/workbench/projects' && req.method === 'POST') {
    sendJson(res, 200, { success: true, ...(await saveWorkbenchProject(await parseJsonBody<Partial<WorkbenchProject>>(req))) });
    return true;
  }
  if (url.pathname.startsWith('/api/workbench/projects/') && req.method === 'DELETE') {
    sendJson(res, 200, { success: true, ...(await deleteWorkbenchProject(decodeURIComponent(url.pathname.slice('/api/workbench/projects/'.length)))) });
    return true;
  }

  if (url.pathname === '/api/workbench/memories' && req.method === 'POST') {
    sendJson(res, 200, { success: true, ...(await saveWorkbenchMemory(await parseJsonBody<Partial<WorkbenchMemory>>(req))) });
    return true;
  }
  if (url.pathname.startsWith('/api/workbench/memories/') && req.method === 'DELETE') {
    sendJson(res, 200, { success: true, ...(await deleteWorkbenchMemory(decodeURIComponent(url.pathname.slice('/api/workbench/memories/'.length)))) });
    return true;
  }

  if (url.pathname === '/api/workbench/tasks' && req.method === 'POST') {
    sendJson(res, 200, { success: true, ...(await saveWorkbenchTask(await parseJsonBody<Partial<AlwaysOnTask>>(req))) });
    return true;
  }
  if (url.pathname.startsWith('/api/workbench/tasks/') && url.pathname.endsWith('/mark-run') && req.method === 'POST') {
    const id = decodeURIComponent(url.pathname.slice('/api/workbench/tasks/'.length, -'/mark-run'.length));
    const body = await parseJsonBody<{ status: AlwaysOnTask['lastRunStatus']; sessionKey?: string }>(req);
    sendJson(res, 200, { success: true, ...(await markWorkbenchTaskRun({ id, status: body.status, sessionKey: body.sessionKey })) });
    return true;
  }
  if (url.pathname.startsWith('/api/workbench/tasks/') && req.method === 'DELETE') {
    sendJson(res, 200, { success: true, ...(await deleteWorkbenchTask(decodeURIComponent(url.pathname.slice('/api/workbench/tasks/'.length)))) });
    return true;
  }

  if (url.pathname === '/api/workbench/routing-rules' && req.method === 'POST') {
    sendJson(res, 200, { success: true, ...(await saveWorkbenchRoutingRule(await parseJsonBody<Partial<RoutingRule>>(req))) });
    return true;
  }
  if (url.pathname.startsWith('/api/workbench/routing-rules/') && req.method === 'DELETE') {
    sendJson(res, 200, { success: true, ...(await deleteWorkbenchRoutingRule(decodeURIComponent(url.pathname.slice('/api/workbench/routing-rules/'.length)))) });
    return true;
  }

  if (url.pathname === '/api/workbench/reports' && req.method === 'POST') {
    sendJson(res, 200, { success: true, ...(await saveWorkbenchReport(await parseJsonBody<Partial<WorkbenchReport>>(req))) });
    return true;
  }
  if (url.pathname.startsWith('/api/workbench/reports/') && req.method === 'DELETE') {
    sendJson(res, 200, { success: true, ...(await deleteWorkbenchReport(decodeURIComponent(url.pathname.slice('/api/workbench/reports/'.length)))) });
    return true;
  }

  if (url.pathname === '/api/workbench/files' && req.method === 'GET') {
    const workspace = url.searchParams.get('workspace') || '';
    const path = url.searchParams.get('path') || '';
    sendJson(res, 200, { success: true, entries: await listTree(workspace, path) });
    return true;
  }

  if (url.pathname === '/api/workbench/file' && req.method === 'GET') {
    const workspace = url.searchParams.get('workspace') || '';
    const path = url.searchParams.get('path') || '';
    sendJson(res, 200, { success: true, ...(await readWorkspaceFile(workspace, path)) });
    return true;
  }

  if (url.pathname === '/api/workbench/file' && req.method === 'PUT') {
    const body = await parseJsonBody<{ workspace: string; path: string; content: string }>(req);
    sendJson(res, 200, { success: true, ...(await writeWorkspaceFile(body.workspace, body.path, body.content)) });
    return true;
  }

  if (url.pathname === '/api/workbench/git-status' && req.method === 'GET') {
    const workspace = url.searchParams.get('workspace') || '';
    sendJson(res, 200, { success: true, ...(await gitStatus(workspace)) });
    return true;
  }

  return false;
}
