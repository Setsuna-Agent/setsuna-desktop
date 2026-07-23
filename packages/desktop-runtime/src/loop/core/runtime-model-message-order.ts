import type { RuntimeMessage, RuntimeToolCall } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';

export const LEGACY_ORPHAN_TOOL_RESULT_OMITTED_WARNING = 'legacy_orphan_tool_result_omitted';

export type RuntimeModelConversationNormalization = {
  messages: RuntimeMessage[];
  warnings: string[];
};

/**
 * Keeps immediately persisted steer messages visible in the transcript while restoring the
 * assistant tool-call -> tool-result ordering required by model provider protocols.
 */
export function normalizeModelConversationOrder(messages: RuntimeMessage[]): RuntimeMessage[] {
  return normalizeModelConversationHistory(messages).messages;
}

/**
 * Repairs model-wire compatibility without mutating semantic history.
 *
 * Provider call IDs are transaction-local in practice, even though provider request formats need
 * them to be unique within one submitted window. Reused IDs are deterministically rewritten on the
 * model-facing copy together with their result. Legacy orphan results are retained for the
 * transcript but hidden from the model because guessing their missing call would be unsafe.
 */
export function normalizeModelConversationHistory(
  messages: RuntimeMessage[],
): RuntimeModelConversationNormalization {
  const compatible = normalizeToolTransactionsForModel(messages);
  assertModelHistoryInvariants(compatible.messages);
  return {
    messages: normalizeConversationOrder(compatible.messages),
    warnings: compatible.warnings,
  };
}

/** Rejects ambiguous tool history before any provider request can use it. */
export function assertModelHistoryInvariants(messages: RuntimeMessage[]): void {
  const callIndexById = new Map<string, number>();
  const resultIndexByCallId = new Map<string, number>();
  for (const [index, message] of messages.entries()) {
    if (message.visibility === 'transcript') continue;
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (!call.id) throw invalidModelHistory('assistant tool call is missing an id');
        if (callIndexById.has(call.id)) {
          throw invalidModelHistory(`duplicate tool call id "${call.id}"`);
        }
        callIndexById.set(call.id, index);
      }
      continue;
    }
    if (message.role !== 'tool') continue;
    if (!message.toolCallId) throw invalidModelHistory(`tool result "${message.id}" is missing a tool call id`);
    if (resultIndexByCallId.has(message.toolCallId)) {
      throw invalidModelHistory(`multiple tool results reference call id "${message.toolCallId}"`);
    }
    resultIndexByCallId.set(message.toolCallId, index);
  }

  for (const [callId, resultIndex] of resultIndexByCallId) {
    const callIndex = callIndexById.get(callId);
    if (callIndex === undefined) {
      throw invalidModelHistory(`tool result references unknown call id "${callId}"`);
    }
    if (callIndex >= resultIndex) {
      throw invalidModelHistory(`tool result for call id "${callId}" appears before its assistant call`);
    }
  }
}

/**
 * Ensures a newly sampled batch is internally unambiguous.
 *
 * A provider may legitimately reuse an ID from an older transaction. The next model request
 * canonicalizes that persisted semantic ID into a window-unique wire ID.
 */
export function assertNewToolCallBatchInvariants(toolCalls: RuntimeToolCall[]): void {
  const batchIds = new Set<string>();
  for (const call of toolCalls) {
    if (!call.id) throw invalidModelHistory('new assistant tool call is missing an id');
    if (batchIds.has(call.id)) {
      throw invalidModelHistory(`duplicate tool call id "${call.id}"`);
    }
    batchIds.add(call.id);
  }
}

function normalizeToolTransactionsForModel(
  messages: RuntimeMessage[],
): RuntimeModelConversationNormalization {
  const output: RuntimeMessage[] = [];
  const warnings = new Set<string>();
  const usedWireIds = new Set<string>();
  let activeCalls = new Map<string, string>();

  for (const message of messages) {
    if (message.visibility === 'transcript') {
      // A hidden assistant is still a transaction boundary. Clearing here prevents an orphan
      // result from being attached to an older visible call that happened to reuse the same ID.
      if (message.role === 'assistant') activeCalls = new Map();
      output.push(message);
      continue;
    }
    if (message.role === 'assistant') {
      activeCalls = new Map();
      const calls = message.toolCalls ?? [];
      const transactionIds = new Set<string>();
      let rewritten = false;
      const toolCalls = calls.map((call, callIndex) => {
        if (!call.id) throw invalidModelHistory('assistant tool call is missing an id');
        if (transactionIds.has(call.id)) {
          throw invalidModelHistory(`duplicate tool call id "${call.id}"`);
        }
        transactionIds.add(call.id);
        const wireId = usedWireIds.has(call.id)
          ? uniqueWireToolCallId(message, call, callIndex, usedWireIds)
          : call.id;
        usedWireIds.add(wireId);
        activeCalls.set(call.id, wireId);
        rewritten ||= wireId !== call.id;
        return wireId === call.id ? call : { ...call, id: wireId };
      });
      if (!rewritten) {
        output.push(message);
        continue;
      }
      // Native envelopes still reference the vendor ID. Once the semantic copy is rewritten,
      // forcing semantic replay is safer than partially rewriting signed/encrypted provider state.
      const rewrittenMessage = { ...message, toolCalls };
      delete rewrittenMessage.providerMetadata;
      output.push(rewrittenMessage);
      continue;
    }
    if (message.role !== 'tool') {
      // A compaction summary starts a replacement model window. Tool results after it cannot be
      // paired with calls that only survived on the archived side of the old boundary.
      if (message.contextCompaction) activeCalls = new Map();
      output.push(message);
      continue;
    }

    const wireId = message.toolCallId
      ? activeCalls.get(message.toolCallId)
      : undefined;
    if (!wireId) {
      output.push({ ...message, visibility: 'transcript' });
      warnings.add(LEGACY_ORPHAN_TOOL_RESULT_OMITTED_WARNING);
      continue;
    }
    output.push(wireId === message.toolCallId
      ? message
      : { ...message, toolCallId: wireId });
  }

  return { messages: output, warnings: [...warnings] };
}

function uniqueWireToolCallId(
  assistantMessage: RuntimeMessage,
  call: RuntimeToolCall,
  callIndex: number,
  usedWireIds: ReadonlySet<string>,
): string {
  let collision = 0;
  while (true) {
    const digest = createHash('sha256')
      .update(`${assistantMessage.id}\0${callIndex}\0${call.id}\0${collision}`)
      .digest('hex')
      .slice(0, 24);
    const candidate = `call_setsuna_${digest}`;
    if (!usedWireIds.has(candidate)) return candidate;
    collision += 1;
  }
}

function normalizeConversationOrder(messages: RuntimeMessage[]): RuntimeMessage[] {
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
    if (deferred.length) output.push(...normalizeConversationOrder(deferred));
  }

  return output;
}

function invalidModelHistory(detail: string): Error {
  return new Error(`Invalid model history: ${detail}.`);
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
