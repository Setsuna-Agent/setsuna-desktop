import type {
  RuntimeActiveTaskState,
  RuntimeActivityList,
  RuntimeThread,
  RuntimeToolRun,
} from '@setsuna-desktop/contracts';
import type { RuntimeContainer } from '../runtime-factory.js';

type RuntimeActivitySource = Pick<
  RuntimeContainer,
  'agentLoop' | 'backgroundShellProcesses' | 'threadStore'
>;

/** Build one bounded, user-facing view over active turns and persisted shell services. */
export async function listRuntimeActivities(
  runtime: RuntimeActivitySource,
): Promise<RuntimeActivityList> {
  const [threadSummaries, backgroundProcesses] = await Promise.all([
    runtime.threadStore.listThreads({ includeArchived: true }),
    runtime.backgroundShellProcesses.listAllBackgroundShellProcesses(),
  ]);
  const threadById = new Map(threadSummaries.map((thread) => [thread.id, thread]));
  const activeThreads = threadSummaries.flatMap((thread) => {
    const turnId = runtime.agentLoop.activeTurnId(thread.id);
    return turnId ? [{ thread, turnId }] : [];
  });
  const activeSnapshots = await Promise.all(
    activeThreads.map(({ thread }) => runtime.threadStore.getThread(thread.id)),
  );
  const tasks = activeThreads.map(({ thread, turnId }, index) => {
    const snapshot = activeSnapshots[index];
    const turn = snapshot?.turns?.find((item) => item.id === turnId);
    return {
      archived: thread.archived,
      ...(thread.projectId ? { projectId: thread.projectId } : {}),
      queuedInputCount: snapshot?.queuedTurnInputs?.length ?? 0,
      startedAt: turn?.startedAt ?? null,
      state: runtimeActiveTaskState(snapshot, turnId),
      taskKind: turn?.taskKind ?? 'regular',
      threadId: thread.id,
      threadTitle: thread.title,
      turnId,
      updatedAt: snapshot?.updatedAt ?? thread.updatedAt,
    };
  }).sort((left, right) => timestampMs(right.startedAt) - timestampMs(left.startedAt));

  return {
    backgroundServices: backgroundProcesses.map((process) => {
      const owner = threadById.get(process.threadId);
      return {
        ...process,
        archived: owner?.archived ?? false,
        ...(owner?.projectId ? { projectId: owner.projectId } : {}),
        threadTitle: owner?.title ?? null,
      };
    }),
    capturedAt: new Date().toISOString(),
    tasks,
  };
}

export function runtimeActiveTaskState(
  thread: RuntimeThread | null,
  turnId: string,
): RuntimeActiveTaskState {
  const pendingRun = thread?.messages
    .filter((message) => message.turnId === turnId)
    .flatMap((message) => message.toolRuns ?? [])
    .find(isPendingRuntimeToolRun);
  if (!pendingRun) return 'running';
  return pendingRun.userInput || pendingRun.elicitation
    ? 'waiting_for_input'
    : 'waiting_for_approval';
}

function isPendingRuntimeToolRun(run: RuntimeToolRun): boolean {
  return run.status === 'pending_approval'
    && run.approvalStatus !== 'approved'
    && run.approvalStatus !== 'rejected'
    && run.approvalStatus !== 'cancelled';
}

function timestampMs(value: string | null): number {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}
