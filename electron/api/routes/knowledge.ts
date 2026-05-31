import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  deleteKnowledgeItem,
  listKnowledgeItems,
  saveKnowledgeItem,
  type KnowledgeItem,
} from '../../utils/knowledge-config';

export async function handleKnowledgeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/knowledge' && req.method === 'GET') {
    sendJson(res, 200, { success: true, items: await listKnowledgeItems() });
    return true;
  }

  if (url.pathname === '/api/knowledge/items' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Partial<KnowledgeItem>>(req);
      sendJson(res, 200, { success: true, items: await saveKnowledgeItem(body) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/knowledge/items/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/knowledge/items/'.length));
      sendJson(res, 200, { success: true, items: await deleteKnowledgeItem(id) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
