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
import { resolveRuntimeModelSelectionInput } from './runtime-model-selection-input.js';
import { runtimeThreadResponse } from './runtime-thread-response.js';
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
    const result = await setRuntimeThreadGoal(runtime, threadId, patch);
    sendJson(response, 200, {
      ...result,
      thread: await runtimeThreadResponse(runtime, result.thread),
    });
    return true;
  }
  if (goalMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(goalMatch[1], 'Thread id');
    const result = await clearRuntimeThreadGoal(runtime, threadId);
    sendJson(response, 200, {
      ...result,
      thread: await runtimeThreadResponse(runtime, result.thread),
    });
    return true;
  }

  const reviewMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/reviews$/u);
  if (reviewMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(reviewMatch[1], 'Thread id');
    const input = await readBody<{
      language?: unknown;
      modelSelection?: unknown;
      model_selection?: unknown;
      target?: unknown;
    }>(request);
    const modelSelection = await resolveRuntimeModelSelectionInput(
      runtime.configStore,
      input.modelSelection ?? input.model_selection,
    );
    const started = await startRuntimeReview(
      runtime,
      threadId,
      input.target,
      input.language,
      modelSelection?.reference,
    );
    sendJson(response, 200, started.response);
    return true;
  }

  return false;
}
