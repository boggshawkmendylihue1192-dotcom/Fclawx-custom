import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  deleteWorkflow,
  deleteWorkflowRun,
  listWorkflowRuns,
  listWorkflows,
  saveWorkflow,
  saveWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRunRecord,
} from '../../utils/workflow-config';

export async function handleWorkflowRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/workflows' && req.method === 'GET') {
    sendJson(res, 200, { success: true, workflows: await listWorkflows(), runs: await listWorkflowRuns() });
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
      sendJson(res, 200, { success: true, workflows: await saveWorkflow(body) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/workflows/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/workflows/'.length));
      sendJson(res, 200, { success: true, workflows: await deleteWorkflow(id) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
