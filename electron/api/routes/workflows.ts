import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { deleteWorkflow, listWorkflows, saveWorkflow, type WorkflowDefinition } from '../../utils/workflow-config';

export async function handleWorkflowRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/workflows' && req.method === 'GET') {
    sendJson(res, 200, { success: true, workflows: await listWorkflows() });
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
