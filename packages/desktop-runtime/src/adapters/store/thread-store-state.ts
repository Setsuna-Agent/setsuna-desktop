import type {
  RuntimeEvent,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import { normalizeRuntimeMessageProviderMetadata } from '@setsuna-desktop/contracts';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';

export const DEFAULT_THREAD_MEMORY_MODE: RuntimeThreadMemoryMode = 'enabled';

export function optionalSafeRuntimeId(value: string | undefined, label: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? assertSafeRuntimeId(normalized, label) : undefined;
}

export function assertThreadSnapshot(thread: RuntimeThread, expectedThreadId: string): void {
  if (
    !thread
    || thread.id !== expectedThreadId
    || !Array.isArray(thread.messages)
    || !Number.isInteger(thread.lastSeq)
    || thread.lastSeq < 0
  ) {
    throw new Error(`Invalid thread snapshot: ${expectedThreadId}`);
  }
}

export function cloneThread(thread: RuntimeThread): RuntimeThread {
  return structuredClone(thread);
}

export function eventCanUseDelayedCheckpoint(event: RuntimeEvent): boolean {
  return event.type === 'message.delta'
    || event.type === 'item.delta'
    || event.type === 'reasoning.summary_delta'
    || event.type === 'reasoning.raw_delta'
    || event.type === 'plan.delta'
    || event.type === 'tool.preview'
    || event.type === 'tool.output_delta';
}

export function toSummary(thread: RuntimeThread): RuntimeThreadSummary {
  return {
    id: thread.id,
    activeTurnId: thread.activeTurnId,
    forkedFromId: thread.forkedFromId,
    parentThreadId: thread.parentThreadId,
    projectId: thread.projectId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archived: thread.archived,
    memoryMode: normalizeThreadMemoryMode(thread.memoryMode),
    gitInfo: thread.gitInfo ? { ...thread.gitInfo } : thread.gitInfo,
    goal: thread.goal ? { ...thread.goal } : undefined,
    messageCount: thread.messageCount,
    lastMessagePreview: thread.lastMessagePreview,
  };
}

export function normalizeThreadSnapshot(thread: RuntimeThread): { changed: boolean; thread: RuntimeThread } {
  const parentThreadId = typeof (thread as { parentThreadId?: unknown }).parentThreadId === 'string'
    ? (thread as { parentThreadId: string }).parentThreadId
    : undefined;
  const memoryMode = normalizeThreadMemoryMode((thread as { memoryMode?: unknown }).memoryMode);
  let changed = parentThreadId !== thread.parentThreadId || memoryMode !== thread.memoryMode;
  let normalized: RuntimeThread = changed ? {
    ...thread,
    parentThreadId,
    memoryMode,
  } : thread;
  if (normalized.contextCompaction?.status === 'running') {
    // Model requests cannot survive a storage rebuild, so a persisted running compaction is stale.
    normalized = { ...normalized, contextCompaction: undefined };
    changed = true;
  }
  const metadataNormalized = normalizeThreadMessageProviderMetadata(normalized);
  normalized = metadataNormalized.thread;
  changed ||= metadataNormalized.changed;
  const migrated = normalizeLegacyCancelledToolRuns(normalized);
  return { changed: changed || migrated !== normalized, thread: migrated };
}

function normalizeThreadMessageProviderMetadata(
  thread: RuntimeThread,
): { changed: boolean; thread: RuntimeThread } {
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (!message.providerMetadata) return message;
    const providerMetadata = normalizeRuntimeMessageProviderMetadata(message.providerMetadata);
    if (providerMetadata && JSON.stringify(providerMetadata) === JSON.stringify(message.providerMetadata)) {
      return message;
    }
    changed = true;
    if (providerMetadata) return { ...message, providerMetadata };
    const normalizedMessage = { ...message };
    delete normalizedMessage.providerMetadata;
    return normalizedMessage;
  });
  return changed ? { changed, thread: { ...thread, messages } } : { changed, thread };
}

/** Migrates legacy snapshots where turn cancellation was projected as a rejected tool run. */
function normalizeLegacyCancelledToolRuns(thread: RuntimeThread): RuntimeThread {
  const cancelledAtByTurn = new Map(
    (thread.turns ?? [])
      .filter((turn) => turn.status === 'cancelled' && turn.completedAt)
      .map((turn) => [turn.id, { completedAt: turn.completedAt, reason: turn.error }]),
  );
  if (!cancelledAtByTurn.size) return thread;
  let changed = false;
  const messages = thread.messages.map((message) => {
    const cancellation = message.turnId ? cancelledAtByTurn.get(message.turnId) : undefined;
    if (!cancellation || !message.toolRuns?.length) return message;
    let messageChanged = false;
    const toolRuns = message.toolRuns.map((run) => {
      if (run.status !== 'rejected' || run.completedAt !== cancellation.completedAt) return run;
      messageChanged = true;
      changed = true;
      const approvalWasCancelled = run.approvalStatus === 'rejected'
        && Boolean(cancellation.reason)
        && run.approvalMessage === cancellation.reason;
      return {
        ...run,
        status: 'cancelled' as const,
        approvalStatus: approvalWasCancelled ? 'cancelled' as const : run.approvalStatus,
      };
    });
    return messageChanged ? { ...message, toolRuns } : message;
  });
  return changed ? { ...thread, messages } : thread;
}

export function normalizeThreadSummary(thread: RuntimeThreadSummary): RuntimeThreadSummary {
  return {
    ...thread,
    parentThreadId: typeof (thread as { parentThreadId?: unknown }).parentThreadId === 'string'
      ? (thread as { parentThreadId: string }).parentThreadId
      : undefined,
    memoryMode: normalizeThreadMemoryMode((thread as { memoryMode?: unknown }).memoryMode),
  };
}

export function threadHasAncestor(
  threadId: string,
  ancestorThreadId: string,
  parentMap: Map<string, string | undefined>,
): boolean {
  const seen = new Set<string>();
  let current = parentMap.get(threadId);
  while (current && !seen.has(current)) {
    if (current === ancestorThreadId) return true;
    seen.add(current);
    current = parentMap.get(current);
  }
  return false;
}

export function normalizeThreadMemoryMode(mode: unknown): RuntimeThreadMemoryMode {
  if (mode === 'enabled' || mode === 'disabled' || mode === 'polluted') return mode;
  return DEFAULT_THREAD_MEMORY_MODE;
}

export function hydrateMessageCompletionTimesFromEvents(
  thread: RuntimeThread,
  events: RuntimeEvent[],
): RuntimeThread {
  const completedAtByMessageId = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'message.completed') {
      completedAtByMessageId.set(event.payload.messageId, event.createdAt);
    }
  }
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (message.completedAt || message.status !== 'complete') return message;
    const completedAt = completedAtByMessageId.get(message.id);
    if (!completedAt) return message;
    changed = true;
    return { ...message, completedAt };
  });
  return changed ? { ...thread, messages } : thread;
}
