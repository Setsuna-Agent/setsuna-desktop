import { objectValue, stringValue } from './provider-values.js';

/**
 * Retains provider argument JSON before AI SDK parses it into a JavaScript
 * value. Native replay compares this string exactly, including whitespace and
 * number spelling.
 */
export class OpenAiResponsesToolArguments {
  private readonly argumentsByCallId = new Map<string, string>();
  private readonly callIdByItemId = new Map<string, string>();

  observe(payload: Record<string, unknown>): void {
    const type = stringValue(payload.type);
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      this.captureOutputItem(objectValue(payload.item));
      return;
    }
    if (
      type === 'response.function_call_arguments.delta'
      || type === 'response.function_call_arguments.done'
    ) {
      this.captureArgumentsEvent(payload, type);
    }
  }

  get(callId: string): string | undefined {
    return this.argumentsByCallId.get(callId);
  }

  private captureOutputItem(item: Record<string, unknown>): void {
    if (stringValue(item.type) !== 'function_call') return;
    const itemId = stringValue(item.id);
    const previousCallId = this.callIdByItemId.get(itemId);
    const callId = stringValue(item.call_id) || previousCallId || itemId;
    if (!callId) return;
    if (itemId) {
      if (
        previousCallId
        && previousCallId !== callId
        && this.argumentsByCallId.has(previousCallId)
        && !this.argumentsByCallId.has(callId)
      ) {
        this.argumentsByCallId.set(
          callId,
          this.argumentsByCallId.get(previousCallId) ?? '',
        );
        this.argumentsByCallId.delete(previousCallId);
      }
      this.callIdByItemId.set(itemId, callId);
    }
    if (typeof item.arguments === 'string') {
      this.argumentsByCallId.set(callId, item.arguments);
    }
  }

  private captureArgumentsEvent(
    payload: Record<string, unknown>,
    type:
      | 'response.function_call_arguments.delta'
      | 'response.function_call_arguments.done',
  ): void {
    const itemId = stringValue(payload.item_id);
    const callId = stringValue(payload.call_id)
      || this.callIdByItemId.get(itemId)
      || itemId;
    if (!callId) return;
    if (itemId) this.callIdByItemId.set(itemId, callId);
    if (type === 'response.function_call_arguments.done') {
      if (typeof payload.arguments === 'string') {
        this.argumentsByCallId.set(callId, payload.arguments);
      }
      return;
    }
    if (typeof payload.delta !== 'string') return;
    this.argumentsByCallId.set(
      callId,
      `${this.argumentsByCallId.get(callId) ?? ''}${payload.delta}`,
    );
  }
}
