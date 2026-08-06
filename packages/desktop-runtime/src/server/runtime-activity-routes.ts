import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { listRuntimeActivities } from '../runtime/use-cases/runtime-activity.js';
import { sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

export async function handleRuntimeActivityRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method !== 'GET' || url.pathname !== '/v1/runtime-activities') {
    return false;
  }
  sendJson(response, 200, await listRuntimeActivities(runtime));
  return true;
}
