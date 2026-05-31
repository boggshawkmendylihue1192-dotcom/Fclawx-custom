import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  deleteWorkflow,
  deleteWorkflowRoleTemplate,
  deleteWorkflowRun,
  listWorkflowRoleTemplates,
  listWorkflowRuns,
  listWorkflows,
  saveWorkflow,
  saveWorkflowRoleTemplate,
  saveWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRoleTemplate,
  type WorkflowRunRecord,
} from '../../utils/workflow-config';

export async function handleWorkflowRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/workflows' && req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      workflows: await listWorkflows(),
      roleTemplates: await listWorkflowRoleTemplates(),
      runs: await listWorkflowRuns(),
    });
    return true;
  }

  if (url.pathname === '/api/workflows/roles' && req.method === 'GET') {
    sendJson(res, 200, { success: true, roleTemplates: await listWorkflowRoleTemplates() });
    return true;
  }

  if (url.pathname === '/api/workflows/roles' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Partial<WorkflowRoleTemplate>>(req);
      sendJson(res, 200, { success: true, roleTemplates: await saveWorkflowRoleTemplate(body) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/workflows/roles/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/workflows/roles/'.length));
      sendJson(res, 200, { success: true, roleTemplates: await deleteWorkflowRoleTemplate(id) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/workflows/runs' && req.method === 'GET') {
    sendJson(res, 200, { success: true, runs: await listWorkflowRuns() });
    return true;
  }

  if (url.pathname === '/api/workflows/runs' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Partial<WorkflowRunRecord>>(req);
      sendJson(res, 200, { success: true, runs: await saveWorkflowRun(body) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/workflows/runs/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/workflows/runs/'.length));
      sendJson(res, 200, { success: true, runs: await deleteWorkflowRun(id) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/workflows' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Partial<WorkflowDefinition>>(req);
      sendJson(res, 200, {
        success: true,
        workflows: await saveWorkflow(body),
        roleTemplates: await listWorkflowRoleTemplates(),
        runs: await listWorkflowRuns(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/workflows/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/workflows/'.length));
      sendJson(res, 200, {
        success: true,
        workflows: await deleteWorkflow(id),
        roleTemplates: await listWorkflowRoleTemplates(),
        runs: await listWorkflowRuns(),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
