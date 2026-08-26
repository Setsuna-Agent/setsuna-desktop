import type {
  RuntimeActivityApproval,
  RuntimeActivityList,
  RuntimeActivityRuntimeHost,
  RuntimeActiveTaskState,
} from '../contracts/index.js';

/** Build one bounded, user-facing view over active turns and persisted shell services. */
export async function projectRuntimeActivities(
  host: RuntimeActivityRuntimeHost,
): Promise<RuntimeActivityList> {
  const [threadSummaries, backgroundProcesses, approvals] = await Promise.all([
    host.listThreads(),
    host.listBackgroundShellProcesses(),
    host.listApprovals(),
  ]);
  const threadById = new Map(threadSummaries.map((thread) => [thread.id, thread]));
  const taskStates = pendingTaskStates(approvals);
  const activeThreads = threadSummaries.flatMap((thread) => {
    const turnId = host.activeTurnId(thread.id);
    return turnId ? [{ thread, turnId }] : [];
  });
  const activeProjections = await Promise.all(
    activeThreads.map(({ thread, turnId }) => (
      host.getTurnActivity(thread.id, turnId)
    )),
  );
  const tasks = activeThreads.map(({ thread, turnId }, index) => {
    const projection = activeProjections[index];
    return {
      archived: thread.archived,
      ...(thread.projectId ? { projectId: thread.projectId } : {}),
      queuedInputCount: projection?.queuedInputCount ?? 0,
      startedAt: projection?.startedAt ?? null,
      state: taskStates.get(taskKey(thread.id, turnId)) ?? 'running',
      taskKind: projection?.taskKind ?? 'regular',
      threadId: thread.id,
      threadKind: thread.kind ?? 'regular',
      threadTitle: thread.title,
      turnId,
      updatedAt: projection?.updatedAt ?? thread.updatedAt,
    };
  }).sort((left, right) => timestampMs(right.startedAt) - timestampMs(left.startedAt));

  return {
    backgroundServices: backgroundProcesses.map((process) => {
      const owner = threadById.get(process.threadId);
      return {
        ...process,
        archived: owner?.archived ?? false,
        ...(owner?.projectId ? { projectId: owner.projectId } : {}),
        threadKind: owner?.kind ?? 'regular',
        threadTitle: owner?.title ?? null,
      };
    }),
    capturedAt: host.now().toISOString(),
    tasks,
  };
}

function pendingTaskStates(
  approvals: readonly RuntimeActivityApproval[],
): Map<string, RuntimeActiveTaskState> {
  const states = new Map<string, RuntimeActiveTaskState>();
  for (const approval of approvals) {
    if (approval.status !== 'pending') continue;
    const key = taskKey(approval.threadId, approval.turnId);
    const state = approval.userInput || approval.elicitation
      ? 'waiting_for_input'
      : 'waiting_for_approval';
    // Structured input is the more specific state when parallel tools wait together.
    if (state === 'waiting_for_input' || !states.has(key)) states.set(key, state);
  }
  return states;
}

function taskKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

function timestampMs(value: string | null): number {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}
