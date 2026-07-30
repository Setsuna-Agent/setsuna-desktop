import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import {
  clearRuntimeThreadGoal,
  deleteRuntimeThread,
  runtimeThreadGoalPatchFromInput,
  setRuntimeThreadGoal,
  startRuntimeReview,
} from '../runtime/use-cases/thread-operations.js';
import { decodeRuntimeId, readBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

/**
 * First-party thread commands that were previously routed through app-server.
 */
export async function handleRuntimeThreadCommandRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)$/u);
  if (threadMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(threadMatch[1], 'Thread id');
    await deleteRuntimeThread(runtime, threadId);
    sendJson(response, 200, { ok: true });
    return true;
  }

  const goalMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/goal$/u);
  if (goalMatch && request.method === 'PUT') {
    const threadId = decodeRuntimeId(goalMatch[1], 'Thread id');
    const patch = runtimeThreadGoalPatchFromInput(
      await readBody<unknown>(request),
    );
    sendJson(response, 200, await setRuntimeThreadGoal(runtime, threadId, patch));
    return true;
  }
  if (goalMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(goalMatch[1], 'Thread id');
    sendJson(response, 200, {
      cleared: await clearRuntimeThreadGoal(runtime, threadId),
    });
    return true;
  }

  const reviewMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/reviews$/u);
  if (reviewMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(reviewMatch[1], 'Thread id');
    const input = await readBody<{ target?: unknown }>(request);
    const started = await startRuntimeReview(runtime, threadId, input.target);
    sendJson(response, 200, started.response);
    return true;
  }

  return false;
}
