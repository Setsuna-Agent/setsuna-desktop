import type {
  AnswerRuntimeApprovalInput,
  RuntimeApprovalStatus,
  RuntimeEvent,
  RuntimeEventBatch,
  RuntimeThread,
  RuntimeThreadSummary,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';
import { applyRuntimeEventToThread, isActiveToolRun } from '@setsuna-desktop/contracts';

export function isThreadContextCompacting(
  compactingThreadId: string | null,
  threadId: string | null,
): boolean {
  return compactingThreadId !== null && compactingThreadId === threadId;
}

export function selectInitialThreadSummary(
  threads: RuntimeThreadSummary[],
  persistedThreadId: string | null,
): RuntimeThreadSummary | undefined {
  if (persistedThreadId) {
    const persistedThread = threads.find((thread) => thread.id === persistedThreadId);
    if (persistedThread) return persistedThread;
  }
  // 侧栏列表按创建时间稳定排序，因此启动兜底要显式选最近活跃的全局对话，而不是列表第一项。
  const globalThreads = threads.filter((thread) => !thread.projectId);
  const candidates = globalThreads.length ? globalThreads : threads;
  return candidates.reduce<RuntimeThreadSummary | undefined>((latest, thread) => (
    !latest || thread.updatedAt.localeCompare(latest.updatedAt) > 0 ? thread : latest
  ), undefined);
}

/**
 * Applies an SSE event only when it belongs to the selected thread and advances its sequence.
 * Callers must use this same decision for projection and every related side effect.
 */
export function applyCurrentThreadEvent(
  thread: RuntimeThread | null,
  event: RuntimeEvent,
): RuntimeThread | null {
  if (!thread || thread.id !== event.threadId || event.seq <= thread.lastSeq) return thread;
  return applyRuntimeEventToThread(thread, event);
}

export type CurrentThreadEventBatchProjection = {
  acceptedEvents: RuntimeEvent[];
  resynced: boolean;
  thread: RuntimeThread | null;
};

/** Applies one ordered bridge batch while retaining the owner and sequence gate. */
export function applyCurrentThreadEventBatch(
  thread: RuntimeThread | null,
  batch: RuntimeEventBatch,
): CurrentThreadEventBatchProjection {
  const acceptedEvents: RuntimeEvent[] = [];
  let projected = thread;
  let resynced = false;
  if (
    batch.resync
    && projected?.id === batch.resync.thread.id
    && batch.resync.thread.lastSeq >= projected.lastSeq
  ) {
    projected = batch.resync.thread;
    resynced = true;
  }
  for (const event of batch.events) {
    const next = applyCurrentThreadEvent(projected, event);
    if (next === projected) continue;
    projected = next;
    acceptedEvents.push(event);
  }
  return { acceptedEvents, resynced, thread: projected };
}

/**
 * Accepts a REST snapshot only while the request still belongs to the selected thread.
 */
export function adoptOwnedThreadSnapshot(
  currentThread: RuntimeThread | null,
  requestedThreadId: string,
  snapshot: RuntimeThread,
): RuntimeThread | null {
  if (
    !currentThread
    || currentThread.id !== requestedThreadId
    || snapshot.id !== requestedThreadId
    || snapshot.lastSeq < currentThread.lastSeq
  ) {
    return currentThread;
  }
  return snapshot;
}

/**
 * 从线程快照中反推仍在运行的 turn。
 *
 * @param thread 当前线程快照。
 * @param terminalTurnIds renderer 已确认终态的 turn ID 集合。
 */
export function inferActiveTurnIdFromThread(
  thread: RuntimeThread | null,
  terminalTurnIds: ReadonlySet<string>,
): string | null {
  if (!thread) return null;
  // 从后往前找可以优先命中最新还在 streaming 或工具运行中的 turn。
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (!message?.turnId || terminalTurnIds.has(message.turnId)) continue;
    if (message.status === 'streaming') return message.turnId;
    if (message.toolRuns?.some(isActiveToolRun)) return message.turnId;
  }
  return null;
}

export function activeTurnIdFromThreadSnapshot(
  thread: RuntimeThread | null,
  terminalTurnIds: ReadonlySet<string>,
): string | null {
  if (!thread) return null;
  // runtime 快照里的 activeTurnId 是真源；消息状态推断只作为旧快照/事件丢失时的兜底。
  if (thread.activeTurnId && !terminalTurnIds.has(thread.activeTurnId)) {
    return thread.activeTurnId;
  }
  return inferActiveTurnIdFromThread(thread, terminalTurnIds);
}

/**
 * 在当前线程快照里乐观更新审批对应的 toolRun。
 */
export function updateThreadApprovalRun(
  thread: RuntimeThread | null,
  approvalId: string,
  input: AnswerRuntimeApprovalInput,
  resolvedAt: string,
): RuntimeThread | null {
  if (!thread) return thread;
  let changed = false;
  const messages = thread.messages.map((message) => {
    if (!message.toolRuns?.some((run) => run.approvalId === approvalId)) return message;
    changed = true;
    return {
      ...message,
      toolRuns: message.toolRuns.map((run) => {
        if (run.approvalId !== approvalId) return run;
        const approvalStatus = approvalStatusForDecision(input.decision);
        const terminal = approvalStatus === 'rejected' || approvalStatus === 'cancelled';
        const nextRun: RuntimeToolRun = {
          ...run,
          approvalStatus,
          approvalMessage: input.message,
          status: terminal ? approvalStatus : 'running',
          completedAt: terminal ? resolvedAt : run.completedAt,
          resultPreview: terminal
            ? input.message || (
              approvalStatus === 'cancelled'
                ? 'Tool call cancelled.'
                : 'Tool call rejected.'
            )
            : run.resultPreview,
        };
        return nextRun;
      }),
    };
  });
  return changed ? { ...thread, updatedAt: resolvedAt, messages } : thread;
}

function approvalStatusForDecision(
  decision: AnswerRuntimeApprovalInput['decision'],
): Exclude<RuntimeApprovalStatus, 'pending'> {
  if (decision === 'cancel') return 'cancelled';
  if (decision === 'reject') return 'rejected';
  return 'approved';
}
