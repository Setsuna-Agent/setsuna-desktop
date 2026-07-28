import { requireFetch, type FetchImpl } from './provider-http.js';
import type { OpenAiResponsesNativeEvents } from './openai-responses-native-events.js';

const EMPTY_API_KEY_PLACEHOLDER = 'setsuna-no-openai-api-key';

export function openAiSdkApiKey(apiKey: string): string {
  return apiKey.trim() || EMPTY_API_KEY_PLACEHOLDER;
}

/**
 * Keeps SDK transport streaming while routing provider extensions and legacy
 * fallback events around the official OpenAI provider's strict validator.
 */
export function createOpenAiResponsesFetch(
  fetchImpl: FetchImpl,
  sendApiKey: boolean,
  nativeEvents: OpenAiResponsesNativeEvents,
  nativeReplayInput?: readonly unknown[],
) {
  const fetcher = requireFetch(fetchImpl);
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : input;
    const requestInit = nativeReplayInput && isResponsesRequest(target)
      ? withNativeReplayInput(init, nativeReplayInput)
      : init;
    const headers = new Headers(requestInit?.headers);
    if (!sendApiKey) headers.delete('authorization');
    if (requestInit !== init) headers.delete('content-length');
    const normalizedHeaders: Record<string, string> = {};
    headers.forEach((value, name) => {
      normalizedHeaders[name] = value;
    });
    const response = await fetcher(target instanceof URL ? target : String(target), {
      ...requestInit,
      headers: normalizedHeaders,
    });
    if (!response.body || !isEventStream(response)) return response;

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-length');
    responseHeaders.delete('content-encoding');
    return new Response(
      response.body.pipeThrough(responsesExtensionTransform(nativeEvents)),
      {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      },
    );
  };
}

function responsesExtensionTransform(
  nativeEvents: OpenAiResponsesNativeEvents,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split(/(?:\r\n|\r|\n){2}/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) processSseBlock(block, controller, encoder, nativeEvents);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) processSseBlock(buffer, controller, encoder, nativeEvents);
      nativeEvents.finishStreaming();
    },
  });
}

function processSseBlock(
  block: string,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  nativeEvents: OpenAiResponsesNativeEvents,
): void {
  const data = sseData(block);
  if (data === '[DONE]') return;
  const payload = parseObject(data);
  if (!payload) {
    if (data) nativeEvents.observeForwardedChunkWithoutEvents();
    controller.enqueue(encoder.encode(`${block}\n\n`));
    return;
  }
  const aiSdkPayload = nativeEvents.aiSdkPayload(payload);
  nativeEvents.observe(payload, Boolean(aiSdkPayload));
  if (!aiSdkPayload) return;
  controller.enqueue(encoder.encode(aiSdkPayload === payload
    ? `${block}\n\n`
    : `event: ${stringEventType(aiSdkPayload)}\ndata: ${JSON.stringify(aiSdkPayload)}\n\n`));
}

function sseData(block: string): string {
  const dataLines: string[] = [];
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
  }
  return dataLines.join('\n');
}

function parseObject(value: string): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isEventStream(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') === true;
}

function isResponsesRequest(input: string | URL): boolean {
  return /\/responses(?:[?#]|$)/i.test(String(input));
}

function withNativeReplayInput(
  init: RequestInit | undefined,
  nativeReplayInput: readonly unknown[],
): RequestInit {
  const body = typeof init?.body === 'string' ? parseObject(init.body) : null;
  if (!body) {
    throw new Error('OpenAI Responses native replay requires a JSON request body.');
  }
  return {
    ...init,
    body: JSON.stringify({
      ...body,
      input: nativeReplayInput,
    }),
  };
}

function stringEventType(payload: Record<string, unknown>): string {
  return typeof payload.type === 'string' ? payload.type : 'message';
}
