import type { RuntimeAssistantMessagePhase } from '../message-metadata.js';
import type { RuntimeStreamItem } from '../provider.js';
import { refreshThreadSummary } from '../thread-event-projection.js';
import type {
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadTurn,
} from '../threads.js';

type AssistantMessageGroup = {
  messages: RuntimeMessage[];
  turnStatus?: RuntimeThreadTurn['status'];
};

/**
 * Resolves old snapshots once at the read/projection boundary. New runtime completions already
 * carry phase, so current threads return without cloning and downstream consumers need no legacy
 * fallback. Provider phase found on an unresolved stream is discarded as a stale hint.
 */
export function normalizeLegacyAssistantPhases(
  thread: RuntimeThread,
): { changed: boolean; thread: RuntimeThread } {
  if (!hasLegacyAssistantPhase(thread)) return { changed: false, thread };

  const normalized = structuredClone(thread);
  for (const group of assistantMessageGroups(normalized)) normalizeMessageGroup(group);
  const phaseByMessageId = new Map(
    normalized.messages
      .filter(isAssistantPresentationMessage)
      .map((message) => [message.id, message.phase] as const),
  );
  for (const turn of normalized.turns ?? []) normalizeTurnItems(turn, phaseByMessageId);
  refreshThreadSummary(normalized);
  return { changed: true, thread: normalized };
}

/** Avoids a full legacy scan at normal runtime terminal events. */
export function normalizeLegacyAssistantPhasesForTurn(
  thread: RuntimeThread,
  turnId: string | undefined,
): RuntimeThread {
  return hasLegacyAssistantPhase(thread, turnId)
    ? normalizeLegacyAssistantPhases(thread).thread
    : thread;
}

function hasLegacyAssistantPhase(thread: RuntimeThread, turnId?: string): boolean {
  const messageNeedsMigration = thread.messages.some((message) => (
    (!turnId || message.turnId === turnId)
    && isAssistantPresentationMessage(message)
    && (message.status === 'streaming' ? message.phase !== undefined : message.phase === undefined)
  ));
  if (messageNeedsMigration) return true;
  return (thread.turns ?? []).some((turn) => (
    (!turnId || turn.id === turnId)
    && turn.items.some((item) => (
      item.kind === 'agent_message'
      && (item.status === 'in_progress' ? item.phase !== undefined : item.phase === undefined)
    ))
  ));
}

function assistantMessageGroups(thread: RuntimeThread): AssistantMessageGroup[] {
  const turnStatus = new Map((thread.turns ?? []).map((turn) => [turn.id, turn.status]));
  const groups = new Map<string, AssistantMessageGroup>();
  let unscopedTurn = 0;

  for (const message of thread.messages) {
    if (message.role === 'user' && message.visibility !== 'model' && !message.turnId) {
      unscopedTurn += 1;
    }
    if (!isAssistantPresentationMessage(message)) continue;
    const key = message.turnId ? `turn:${message.turnId}` : `legacy:${unscopedTurn}`;
    const group = groups.get(key) ?? {
      messages: [],
      turnStatus: message.turnId ? turnStatus.get(message.turnId) : undefined,
    };
    group.messages.push(message);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function normalizeMessageGroup(group: AssistantMessageGroup): void {
  const successful = group.turnStatus
    ? group.turnStatus === 'completed'
    : group.messages.every((message) => message.status !== 'streaming' && message.status !== 'error');
  const hasFinal = group.messages.some((message) => (
    message.status !== 'streaming' && message.phase === 'final_answer'
  ));
  const finalMessage = successful && !hasFinal
    ? [...group.messages].reverse().find(isLegacyFinalMessageCandidate)
    : undefined;

  for (const message of group.messages) {
    if (message.status === 'streaming') {
      delete message.phase;
    } else if (message.phase === undefined) {
      message.phase = message === finalMessage ? 'final_answer' : 'commentary';
    }
  }
}

function normalizeTurnItems(
  turn: RuntimeThreadTurn,
  phaseByMessageId: Map<string, RuntimeAssistantMessagePhase | undefined>,
): void {
  const unlinked: RuntimeStreamItem[] = [];
  for (const item of turn.items) {
    if (item.kind !== 'agent_message') continue;
    if (item.transcriptMessageId && phaseByMessageId.has(item.transcriptMessageId)) {
      const phase = phaseByMessageId.get(item.transcriptMessageId);
      if (phase) item.phase = phase;
      else delete item.phase;
    } else {
      unlinked.push(item);
    }
  }

  const successful = turn.status === 'completed'
    || (!turn.status && unlinked.every((item) => (
      item.status !== 'in_progress' && item.status !== 'failed' && item.status !== 'cancelled'
    )));
  const finalItem = successful
    ? [...unlinked].reverse().find((item) => (
      item.status !== 'in_progress'
      && item.status !== 'failed'
      && item.status !== 'cancelled'
      && Boolean(item.content?.trim())
    ))
    : undefined;
  for (const item of unlinked) {
    if (item.status === 'in_progress') delete item.phase;
    else item.phase = item === finalItem ? 'final_answer' : 'commentary';
  }
}

function isAssistantPresentationMessage(message: RuntimeMessage): boolean {
  return message.role === 'assistant'
    && message.visibility !== 'model'
    && !message.contextCompaction
    && !message.planMode;
}

function isLegacyFinalMessageCandidate(message: RuntimeMessage): boolean {
  return message.status !== 'streaming'
    && message.status !== 'error'
    && Boolean(message.content.trim())
    && !message.toolCalls?.length;
}
