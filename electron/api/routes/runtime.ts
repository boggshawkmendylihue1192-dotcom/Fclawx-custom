import type { IncomingMessage, ServerResponse } from 'http';
import {
  checkOpenClawRuntimeUpdate,
  getOpenClawRuntimeStatus,
  getRuntimeUpgradePrerequisiteHint,
  rollbackOpenClawRuntime,
  upgradeOpenClawRuntime,
} from '../../utils/openclaw-runtime-updater';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleRuntimeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/runtime/openclaw' && req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      hint: getRuntimeUpgradePrerequisiteHint(),
      status: await getOpenClawRuntimeStatus(),
    });
    return true;
  }

  if (url.pathname === '/api/runtime/openclaw/check' && req.method === 'GET') {
    sendJson(res, 200, {
      success: true,
      hint: getRuntimeUpgradePrerequisiteHint(),
      status: await checkOpenClawRuntimeUpdate(),
    });
    return true;
  }

  if (url.pathname === '/api/runtime/openclaw/upgrade' && req.method === 'POST') {
    const body = await parseJsonBody<{ version?: string }>(req);
    const result = await upgradeOpenClawRuntime(ctx.gatewayManager, body.version);
    sendJson(res, 200, result);
    return true;
  }

  if (url.pathname === '/api/runtime/openclaw/rollback' && req.method === 'POST') {
    const result = await rollbackOpenClawRuntime(ctx.gatewayManager);
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
