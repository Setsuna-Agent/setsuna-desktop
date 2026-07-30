import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { handleRuntimeCapabilityRequest } from './runtime-capability-routes.js';
import { handleRuntimeConfigRequest } from './runtime-config-routes.js';
import { handleRuntimeExtensionRequest } from './runtime-extension-routes.js';
import { handleRuntimeMemoryUsageRequest } from './runtime-memory-usage-routes.js';
import { handleRuntimeResourceRequest } from './runtime-resource-routes.js';
import { handleRuntimeThreadCommandRequest } from './runtime-thread-command-routes.js';
import { handleRuntimeThreadRequest } from './runtime-thread-routes.js';
import { handleRuntimeTurnRequest } from './runtime-turn-routes.js';
import { handleRuntimeWorkspaceRequest } from './runtime-workspace-routes.js';
import type { RuntimeFactory } from './types.js';

/**
 * The REST facade owns only deterministic route-family ordering. Each family
 * keeps protocol parsing close to its domain and delegates shared behavior to
 * runtime use cases where another protocol needs the same capability.
 */
export async function handleRuntimeRestRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (await handleRuntimeThreadCommandRequest(runtime, request, response, url)) {
    return true;
  }
  if (await handleRuntimeCapabilityRequest(runtime, request, response, url)) {
    return true;
  }
  if (await handleRuntimeWorkspaceRequest(runtime, request, response, url)) {
    return true;
  }
  if (await handleRuntimeMemoryUsageRequest(runtime, request, response, url)) {
    return true;
  }
  if (await handleRuntimeResourceRequest(runtime, request, response, url)) {
    return true;
  }
  if (await handleRuntimeConfigRequest(runtime, request, response, url)) {
    return true;
  }
  if (await handleRuntimeExtensionRequest(runtime, request, response, url)) {
    return true;
  }
  if (await handleRuntimeThreadRequest(runtime, request, response, url)) {
    return true;
  }
  if (await handleRuntimeTurnRequest(runtime, request, response, url)) {
    return true;
  }
  return false;
}
