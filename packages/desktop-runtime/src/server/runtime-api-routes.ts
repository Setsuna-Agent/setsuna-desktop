import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RuntimeApiEventHistory } from '@setsuna-desktop/contracts';
import { installLocalPlugin } from '@setsuna-desktop/feature-plugin-management/contracts';
import type { RuntimeFactory } from './types.js';
import { decodeRuntimeId, sendJson } from './http-utils.js';
import { RuntimeHttpError } from './http-error.js';

const CORE_EXAMPLES = [
  { method: 'GET', path: '/v1/projects', description: 'All saved, non-archived projects; no active project required.' },
  { method: 'POST', path: '/v1/projects', description: 'Register a project. Body: {path}.' },
  { method: 'GET', path: '/v1/threads?scope=all&includeArchived=true', description: 'Conversation summaries, including project conversations. Optional search/projectId filters.' },
  { method: 'POST', path: '/v1/threads', description: 'Create a conversation. Body may include title and projectId.' },
  { method: 'GET', path: '/v1/threads/:threadId?messageLimit=50', description: 'Conversation snapshot with messages, tool runs and current state.' },
  { method: 'PATCH', path: '/v1/threads/:threadId', description: 'Update conversation title or archived state.' },
  { method: 'DELETE', path: '/v1/threads/:threadId', description: 'Delete through the desktop host after checking unsaved changes in all windows. Cancellation returns {ok:false,status:409,data:{cancelled:true}}.' },
  { method: 'GET', path: '/v1/threads/:threadId/messages?limit=50', description: 'Message history. Pass returned nextBefore as before to read older pages.' },
  { method: 'GET', path: '/v1/threads/:threadId/event-history?sinceSeq=0&limit=100', description: 'Persisted events including tool inputs, outputs and lifecycle. Continue from nextSinceSeq; poll for new events.' },
  { method: 'GET', path: '/v1/threads/:threadId/tool-results/:resultId?offset=0&limit=32000', description: 'Full stored tool output when an event contains a truncated-result reference. Continue from nextOffset (UTF-8 bytes).' },
  { method: 'POST', path: '/v1/threads/:threadId/turns', description: 'Send a message to the AI. Body: {input: "..."}; use the existing turn policy fields when needed.' },
  { method: 'GET', path: '/v1/config', description: 'Public runtime configuration.' },
  { method: 'GET', path: '/v1/feature-management/status', description: 'Available features and settings documents.' },
  { method: 'GET', path: '/v1/approvals', description: 'Pending approvals.' },
  { method: 'GET', path: '/v1/mcp/servers', description: 'Configured MCP servers and authentication status.' },
] as const;

export async function handleRuntimeApiRequest(
  runtime: RuntimeFactory, request: IncomingMessage, response: ServerResponse, url: URL,
): Promise<boolean> {
  if (request.method !== 'GET') return false;
  if (url.pathname === '/v1/runtime-api') {
    sendJson(response, 200, {
      description: 'Trusted sidebar apps and extension handlers can call /v1 backend routes with {path, method, body}. These examples are not an allowlist. Local plugin import requires the native directory picker; conversation deletion requires desktop coordination via DELETE /v1/threads/:id. Responses are {ok, status, data}. Binary data is {mimeType, base64}. Runtime tokens stay in the host.',
      coreExamples: CORE_EXAMPLES,
      featureOperations: runtime.featureRoutes.describe().filter((operation) => operation.path !== installLocalPlugin.path),
    });
    return true;
  }
  const resultMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/tool-results\/([^/]+)$/u);
  if (resultMatch) {
    const result = await runtime.toolResultStore.read(
      decodeRuntimeId(resultMatch[1], 'Thread id'), decodeRuntimeId(resultMatch[2], 'Result id'),
      integerQuery(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER), integerQuery(url, 'limit', 32_000, 1, 1_000_000),
    );
    if (!result) throw new RuntimeHttpError(404, 'Stored tool result not found for this thread.');
    sendJson(response, 200, result);
    return true;
  }
  const match = url.pathname.match(/^\/v1\/threads\/([^/]+)\/event-history$/u);
  if (!match) return false;
  const threadId = decodeRuntimeId(match[1], 'Thread id');
  const thread = await runtime.threadStore.getThreadPage(threadId, { limit: 1 });
  if (!thread) throw new RuntimeHttpError(404, 'Thread not found');
  const sinceSeq = integerQuery(url, 'sinceSeq', 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = integerQuery(url, 'limit', 100, 1, 1_000);
  const events = await runtime.threadStore.readEventPage(threadId, {
    afterSeq: sinceSeq, throughSeq: thread.lastSeq, limit: limit + 1,
  });
  const page = events.slice(0, limit);
  sendJson(response, 200, {
    events: page,
    nextSinceSeq: page.at(-1)?.seq ?? sinceSeq,
    hasMore: events.length > limit,
    latestSeq: thread.lastSeq,
  } satisfies RuntimeApiEventHistory);
  return true;
}

function integerQuery(url: URL, name: string, fallback: number, min: number, max: number): number {
  const value = url.searchParams.get(name);
  const result = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new RuntimeHttpError(400, `Invalid ${name}.`);
  return result;
}
