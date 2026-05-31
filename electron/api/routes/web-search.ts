import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  getWebSearchConfigSnapshot,
  updateWebSearchConfig,
  type WebSearchConfigUpdate,
} from '../../utils/web-search-config';

function scheduleGatewayReload(ctx: HostApiContext): void {
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
  }
}

export async function handleWebSearchRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/web-search' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await getWebSearchConfigSnapshot()) });
    return true;
  }

  if (url.pathname === '/api/web-search' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<WebSearchConfigUpdate>(req);
      const snapshot = await updateWebSearchConfig(body);
      scheduleGatewayReload(ctx);
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
