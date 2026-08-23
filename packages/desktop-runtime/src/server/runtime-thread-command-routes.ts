import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import {
  deleteRuntimeThread,
  startRuntimeReview,
} from '../runtime/use-cases/thread-operations.js';
import { decodeRuntimeId, readBody, sendJson } from './http-utils.js';
import { resolveRuntimeModelSelectionInput } from './runtime-model-selection-input.js';
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
