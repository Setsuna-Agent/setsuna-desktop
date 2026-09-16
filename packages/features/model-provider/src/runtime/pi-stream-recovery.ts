import type { ModelStreamEvent, RuntimeStreamItem } from '@setsuna-desktop/contracts';

const MAX_STREAM_RETRIES = 2;
const INCOMPLETE_STREAM_ERRORS = new Set([
  'Stream ended without finish_reason',
  'OpenAI Responses stream ended without a stop reason',
  'OpenAI Responses stream ended before a terminal response event',
  'Anthropic stream ended without a stop reason',
  'Pi provider stream ended without a terminal assistant message.',
]);

/** Retry an incomplete sampling step only while it has emitted reasoning or nothing. */
export async function* recoverIncompletePiStream(
  createStream: () => AsyncIterable<ModelStreamEvent>,
  signal: AbortSignal,
): AsyncGenerator<ModelStreamEvent> {
  for (let retry = 0; ; retry += 1) {
    signal.throwIfAborted();
    const reasoningItems = new Map<string, RuntimeStreamItem>();
    let reasoningOnly = true;
    try {
      for await (const event of createStream()) {
        reasoningOnly = observeReasoning(event, reasoningItems) && reasoningOnly;
        yield event;
      }
      return;
    } catch (error) {
      signal.throwIfAborted();
      if (
        !reasoningOnly
        || retry >= MAX_STREAM_RETRIES
        || !(error instanceof Error)
        || !INCOMPLETE_STREAM_ERRORS.has(error.message)
      ) throw error;

      // Preserve the failed attempt's live reasoning for inspection. Only a successful
      // attempt supplies replay metadata; no partial answer or tool call is replayed.
      for (const item of reasoningItems.values()) {
        yield { type: 'item_completed', item: { ...item, status: 'failed' } };
      }
      yield {
        type: 'model_verification',
        verification: {
          warnings: [`模型响应未正常结束，正在重新请求（${retry + 1}/${MAX_STREAM_RETRIES}）。`],
        },
      };
      await waitForRetry(1_000 * 2 ** retry, signal);
    }
  }
}

function observeReasoning(
  event: ModelStreamEvent,
  items: Map<string, RuntimeStreamItem>,
): boolean {
  if (event.type === 'item_started' || event.type === 'item_completed') {
    // Legacy <think> streams open an empty text item before the decoder resolves its channel.
    if (event.item.kind === 'agent_message') return !event.item.content;
    if (event.item.kind !== 'reasoning') return false;
    items.set(event.item.id, { ...event.item });
    return true;
  }
  if (event.type === 'item_delta') {
    const item = items.get(event.itemId);
    if (!item) return false;
    item.content = (item.content ?? '') + event.delta;
    return true;
  }
  // Fail closed for other output, including text deltas, tool calls and terminal metadata.
  return false;
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
