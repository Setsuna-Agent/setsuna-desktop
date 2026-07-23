import {
  isRuntimeGeneratedMessageAttachment,
  isRuntimeInlineMessageAttachment,
  normalizeRuntimeMessageProviderMetadata,
  type RuntimeEvent,
  type RuntimeMessage,
  type RuntimeMessageAttachment,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { managedGeneratedImageAssetIds } from '../utils/generated-image-assets.js';
import { AppServerRpcError } from './app-server/errors.js';
import { randomRuntimeId } from './runtime-ids.js';
import { compareNullableMs, maxNullableMs, minNullableMs, parseDateMs } from './time-utils.js';
import type { RuntimeFactory } from './types.js';

export { randomRuntimeId } from './runtime-ids.js';

export async function requireRuntimeThread(runtime: RuntimeFactory, threadId: string): Promise<RuntimeThread> {
  const thread = await runtime.threadStore.getThread(threadId);
  if (!thread) throw new AppServerRpcError(-32004, 'Thread not found', { threadId });
  return thread;
}

export async function settleStaleRuntimeTurns(runtime: RuntimeFactory): Promise<void> {
  const summaries = await runtime.threadStore.listThreads({ includeArchived: true });
  for (const summary of summaries) {
    const thread = await runtime.threadStore.getThread(summary.id);
    if (!thread) continue;
    for (const turnId of activeTurnIdsInThread(thread)) {
      await appendAndPublishRuntimeEvent(runtime, thread.id, {
        id: randomRuntimeId('event_cancel'),
        threadId: thread.id,
        turnId,
        type: 'turn.cancelled',
        createdAt: new Date().toISOString(),
        payload: { reason: 'Turn cancelled because the desktop runtime restarted.' },
      });
    }
  }
}

export async function cancelRuntimeTurn(runtime: RuntimeFactory, threadId: string, turnId: string): Promise<boolean> {
  const cancelled = await runtime.agentLoop.cancelTurn(threadId, turnId);
  if (cancelled) return true;
  const thread = await runtime.threadStore.getThread(threadId);
  if (!thread || !runtimeTurnAppearsActive(thread, turnId)) return false;
  await appendAndPublishRuntimeEvent(runtime, threadId, {
    id: randomRuntimeId('event_cancel'),
    threadId,
    turnId,
    type: 'turn.cancelled',
    createdAt: new Date().toISOString(),
    payload: { reason: 'Turn cancelled.' },
  });
  return true;
}

function activeTurnIdsInThread(thread: RuntimeThread): string[] {
  const turnIds = new Set<string>();
  if (thread.activeTurnId) turnIds.add(thread.activeTurnId);
  for (const turn of thread.turns ?? []) {
    if (turn.status === 'in_progress' || turn.items.some((item) => item.status === 'in_progress')) {
      turnIds.add(turn.id);
    }
  }
  for (const message of thread.messages) {
    if (!message.turnId) continue;
    if (message.status === 'streaming' || message.toolRuns?.some(isActiveRuntimeToolRun)) {
      turnIds.add(message.turnId);
    }
  }
  return [...turnIds];
}

function runtimeTurnAppearsActive(thread: RuntimeThread, turnId: string): boolean {
  return activeTurnIdsInThread(thread).includes(turnId);
}

function isActiveRuntimeToolRun(run: NonNullable<RuntimeMessage['toolRuns']>[number]): boolean {
  return run.status === 'running' || (
    run.status === 'pending_approval'
    && run.approvalStatus !== 'approved'
    && run.approvalStatus !== 'rejected'
    && run.approvalStatus !== 'cancelled'
  );
}

export async function runAppServerThreadShellCommand(
  runtime: RuntimeFactory,
  thread: RuntimeThread,
  command: string,
  activeTurnId: string | null = null,
): Promise<void> {
  await runtime.agentLoop.runUserShellCommand(thread.id, command, activeTurnId);
}

export async function appendAndPublishRuntimeEvent(
  runtime: RuntimeFactory,
  threadId: string,
  event: Omit<RuntimeEvent, 'seq'>,
): Promise<RuntimeEvent> {
  const saved = await runtime.eventWriter.append(threadId, event);
  if (!saved) throw new Error('Lifecycle events must not be buffered.');
  return saved;
}

export async function copyRuntimeMessagesToThread(
  runtime: RuntimeFactory,
  threadId: string,
  messages: RuntimeMessage[],
): Promise<void> {
  const cloned = await cloneForkMessages(runtime, messages);
  const committedAssetIds = new Set<string>();
  let appendAttempted = false;
  try {
    await runtime.eventWriter.flushThread(threadId);
    let index = 0;
    for (const message of cloned.messages) {
      index += 1;
      const createdAt = new Date().toISOString();
      appendAttempted = true;
      await runtime.threadStore.appendEvent(threadId, {
        id: `event_fork_${message.id}_${index}`,
        threadId,
        turnId: message.turnId,
        type: 'message.created',
        createdAt,
        payload: { message },
      });
      for (const attachment of message.attachments ?? []) {
        if (isRuntimeGeneratedMessageAttachment(attachment)) committedAssetIds.add(attachment.assetId);
      }
    }
  } catch (error) {
    if (appendAttempted) {
      try {
        const snapshot = await runtime.threadStore.getThread(threadId);
        for (const assetId of managedGeneratedImageAssetIds(snapshot)) committedAssetIds.add(assetId);
      } catch {
        // The failed append may already be present in the event log. Keep every clone when that
        // cannot be confirmed; the caller's thread deletion or startup recovery will clean it up.
        throw error;
      }
    }
    const uncommittedAssetIds = cloned.assetIds.filter((assetId) => !committedAssetIds.has(assetId));
    await Promise.allSettled(uncommittedAssetIds.map((assetId) => runtime.generatedImageStore.delete(assetId)));
    throw error;
  }
}

async function cloneForkMessages(
  runtime: RuntimeFactory,
  messages: RuntimeMessage[],
): Promise<{ assetIds: string[]; messages: RuntimeMessage[] }> {
  const clonedAssetIds: string[] = [];
  const clonesBySourceId = new Map<string, string>();
  try {
    const clonedMessages: RuntimeMessage[] = [];
    for (const message of messages) {
      const clonedMessage = cloneRuntimeMessage(message);
      const attachments: RuntimeMessageAttachment[] = [];
      for (const attachment of clonedMessage.attachments ?? []) {
        if (isRuntimeGeneratedMessageAttachment(attachment)) {
          let clonedAssetId = clonesBySourceId.get(attachment.assetId);
          if (!clonedAssetId) {
            const clonedAsset = await runtime.generatedImageStore.clone(attachment.assetId);
            clonedAssetId = clonedAsset.assetId;
            clonesBySourceId.set(attachment.assetId, clonedAssetId);
            clonedAssetIds.push(clonedAssetId);
          }
          attachments.push({ ...attachment, assetId: clonedAssetId });
        } else if (isRuntimeInlineMessageAttachment(attachment) && attachment.localAssetId) {
          // Legacy inline images retain their Data URL, so a fork can recreate its own local cache on demand.
          const inlineAttachment = { ...attachment };
          delete inlineAttachment.localAssetId;
          attachments.push(inlineAttachment);
        } else {
          attachments.push(attachment);
        }
      }
      clonedMessages.push({ ...clonedMessage, attachments });
    }
    return { assetIds: clonedAssetIds, messages: clonedMessages };
  } catch (error) {
    await Promise.allSettled(clonedAssetIds.map((assetId) => runtime.generatedImageStore.delete(assetId)));
    throw error;
  }
}

export function runtimeMessagesThroughTurn(messages: RuntimeMessage[], lastTurnId: string | undefined): RuntimeMessage[] {
  if (!lastTurnId) return messages;
  const order = runtimeTurnOrder(messages);
  const cutoff = order.get(lastTurnId);
  if (!cutoff) throw new AppServerRpcError(-32602, `Unknown lastTurnId: ${lastTurnId}`);
  return messages.filter((message) => {
    if (message.turnId) return (order.get(message.turnId)?.order ?? Number.POSITIVE_INFINITY) <= cutoff.order;
    const createdAtMs = parseDateMs(message.createdAt);
    return createdAtMs !== null && compareNullableMs(createdAtMs, cutoff.endMs) <= 0;
  });
}

export function rollbackStartMessageId(messages: RuntimeMessage[], numTurns: number): string | null {
  const order = runtimeTurnOrder(messages);
  if (!order.size) return null;
  const firstDroppedOrder = Math.max(0, order.size - numTurns);
  const firstDropped = [...order.entries()].find(([, turn]) => turn.order === firstDroppedOrder);
  if (!firstDropped) return null;
  const [turnId] = firstDropped;
  return messages.find((message) => message.turnId === turnId)?.id ?? null;
}

function runtimeTurnOrder(messages: RuntimeMessage[]): Map<string, { endMs: number | null; order: number }> {
  const turns = new Map<string, { endMs: number | null; firstIndex: number; startMs: number | null; turnId: string }>();
  for (const [index, message] of messages.entries()) {
    if (!message.turnId) continue;
    const createdAtMs = parseDateMs(message.createdAt);
    const existing = turns.get(message.turnId);
    if (!existing) {
      turns.set(message.turnId, {
        endMs: createdAtMs,
        firstIndex: index,
        startMs: createdAtMs,
        turnId: message.turnId,
      });
      continue;
    }
    existing.firstIndex = Math.min(existing.firstIndex, index);
    existing.startMs = minNullableMs(existing.startMs, createdAtMs);
    existing.endMs = maxNullableMs(existing.endMs, createdAtMs);
  }

  return new Map(
    [...turns.values()]
      .sort((left, right) => compareNullableMs(left.startMs, right.startMs) || left.firstIndex - right.firstIndex)
      .map((turn, index) => [turn.turnId, { endMs: turn.endMs, order: index }]),
  );
}

function cloneRuntimeMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    contextCompaction: message.contextCompaction ? { ...message.contextCompaction } : undefined,
    planMode: message.planMode ? { ...message.planMode } : undefined,
    providerMetadata: message.providerMetadata
      ? normalizeRuntimeMessageProviderMetadata(message.providerMetadata)
      : undefined,
    reviewMode: message.reviewMode ? { ...message.reviewMode } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map((toolRun) => ({ ...toolRun })),
  };
}
