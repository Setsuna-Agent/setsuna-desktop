import type { RuntimeMessage, RuntimeToolCall } from '@setsuna-desktop/contracts';

/**
 * Keeps immediately persisted steer messages visible in the transcript while restoring the
 * assistant tool-call -> tool-result ordering required by model provider protocols.
 */
export function normalizeModelConversationOrder(messages: RuntimeMessage[]): RuntimeMessage[] {
  const output: RuntimeMessage[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index]!;
    output.push(message);
    index += 1;
    if (message.visibility === 'transcript' || message.role !== 'assistant' || !message.toolCalls?.length) continue;

    const pendingCalls = new Map(message.toolCalls.map((call) => [call.id, call]));
    const deferred: RuntimeMessage[] = [];
    while (index < messages.length && pendingCalls.size) {
      const candidate = messages[index]!;
      index += 1;
      if (
        candidate.role === 'tool'
        && candidate.visibility !== 'transcript'
        && candidate.toolCallId
        && pendingCalls.has(candidate.toolCallId)
      ) {
        output.push(candidate);
        pendingCalls.delete(candidate.toolCallId);
      } else {
        deferred.push(candidate);
      }
    }

    for (const call of pendingCalls.values()) output.push(interruptedToolResult(message, call));
    if (deferred.length) output.push(...normalizeModelConversationOrder(deferred));
  }

  return output;
}

function interruptedToolResult(assistantMessage: RuntimeMessage, call: RuntimeToolCall): RuntimeMessage {
  return {
    id: `model_recovery_${assistantMessage.id}_${call.id}`,
    turnId: assistantMessage.turnId,
    role: 'tool',
    content: `Tool ${call.name} did not produce a recorded result because its execution was interrupted.`,
    toolCallId: call.id,
    toolName: call.name,
    createdAt: assistantMessage.createdAt,
    status: 'complete',
    visibility: 'model',
  };
}
