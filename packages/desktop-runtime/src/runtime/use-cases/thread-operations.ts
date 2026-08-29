import type {
  RuntimeConfiguredModelReference,
  RuntimeThread,
  RuntimeThreadGoal,
  RuntimeThreadGoalPatch,
  RuntimeThreadGoalStatus,
  SendTurnResponse,
} from '@setsuna-desktop/contracts';
import {
  startReviewInputCodec,
  type ReviewTurnRequest,
  type StartReviewInput,
} from '@setsuna-desktop/feature-review/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { RuntimeContainer } from '../runtime-factory.js';
import { randomRuntimeId } from '../runtime-id.js';
import { RuntimeUseCaseError, runtimeUseCaseErrorMessage } from './errors.js';

export type RuntimeReviewStartResult = {
  response: SendTurnResponse;
  review: ReviewTurnRequest;
};

const MAX_RUNTIME_GOAL_OBJECTIVE_LENGTH = 4_000;

export async function requireRuntimeThread(
  runtime: RuntimeContainer,
  threadId: string,
): Promise<RuntimeThread> {
  const thread = await runtime.threadStore.getThread(threadId);
  if (!thread) {
    throw new RuntimeUseCaseError(
      'thread_not_found',
      'Thread not found',
      { threadId },
    );
  }
  return thread;
}

/**
 * Owns destructive thread deletion after protocol parsing. Both REST and
 * app-server must cross the same deletion barrier and run the same teardown.
 *
 * 父线程删除前必须先级联删除所有直属 child（含其运行中的 turn），
 * 保证不留下孤儿协作线程；v1 最大深度为 1，递归仅作防御。
 */
export async function deleteRuntimeThread(
  runtime: RuntimeContainer,
  threadId: string,
): Promise<void> {
  await runtime.agentLoop.withThreadDeletionBarrier(threadId, async () => {
    // The parent barrier prevents a running parent turn from spawning another child between this
    // snapshot and the parent commit. Child deletion uses its own barrier recursively.
    const children = await runtime.threadStore.listThreads({
      includeArchived: true,
      includeSide: true,
      parentThreadId: threadId,
    });
    for (const child of children) {
      await deleteRuntimeThread(runtime, child.id);
    }

    // Cancellation and terminal cleanup may advance lastSeq while waiting for
    // the deletion barrier, so the final event boundary must use a fresh read.
    const thread = await requireRuntimeThread(runtime, threadId);
    await runtime.threadStore.deleteThread(threadId);

    // The persisted stream no longer exists after deletion. Publish this
    // lifecycle event only after the destructive store commit succeeds.
    runtime.eventBus.publish({
      id: randomRuntimeId('event_deleted'),
      seq: thread.lastSeq + 1,
      threadId,
      type: 'thread.deleted',
      createdAt: new Date().toISOString(),
      payload: {},
    });

    // The commit already succeeded; teardown is best-effort so callers never
    // retry a deletion merely because one secondary cleanup failed.
    const cleanupTasks = [
      { label: 'dynamic tools', run: () => runtime.agentLoop.clearAppServerDynamicTools(threadId) },
      { label: 'MCP connections', run: () => runtime.mcpControl.releaseThread(threadId) },
      { label: 'attachments', run: () => runtime.attachmentStore.releaseThread(threadId) },
      { label: 'tool results', run: () => runtime.toolResultStore.releaseThread(threadId) },
      ...(!thread.projectId || thread.kind === 'side'
        ? [{
          label: 'temporary workspace',
          run: () => runtime.workspaceProjects.removeTemporaryWorkspace({
            threadId,
            createdAt: thread.createdAt,
          }),
        }]
        : []),
    ];
    const cleanupResults = await Promise.allSettled(
      cleanupTasks.map((task) => Promise.resolve().then(task.run)),
    );
    cleanupResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[desktop-runtime] Thread ${threadId} was deleted, but ${cleanupTasks[index].label} cleanup failed.`,
          result.reason,
        );
      }
    });
  });
}

export async function setRuntimeThreadGoal(
  runtime: RuntimeContainer,
  threadId: string,
  patch: RuntimeThreadGoalPatch,
): Promise<Readonly<{ goal: RuntimeThreadGoal; thread: RuntimeThread }>> {
  try {
    return await runtime.agentLoop.withThreadMutation(threadId, async () => {
      await requireRuntimeThread(runtime, threadId);
      const goal = await runtime.agentLoop.setThreadGoal(threadId, patch);
      return { goal, thread: await requireRuntimeThread(runtime, threadId) };
    });
  } catch (error) {
    if (error instanceof RuntimeUseCaseError) throw error;
    throw new RuntimeUseCaseError('conflict', runtimeUseCaseErrorMessage(error));
  }
}

export function runtimeThreadGoalPatchFromInput(
  value: unknown,
): RuntimeThreadGoalPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeUseCaseError(
      'invalid_input',
      'Goal patch must be an object.',
    );
  }
  const input = value as Record<string, unknown>;
  const patch: RuntimeThreadGoalPatch = {};

  if (hasOwn(input, 'objective')) {
    if (typeof input.objective !== 'string') {
      throw new RuntimeUseCaseError(
        'invalid_input',
        'Goal objective must be a string.',
      );
    }
    const objective = input.objective.trim();
    if (!objective) {
      throw new RuntimeUseCaseError(
        'invalid_input',
        'Goal objective must not be empty.',
      );
    }
    if ([...objective].length > MAX_RUNTIME_GOAL_OBJECTIVE_LENGTH) {
      throw new RuntimeUseCaseError(
        'invalid_input',
        `Goal objective must be at most ${MAX_RUNTIME_GOAL_OBJECTIVE_LENGTH} characters.`,
      );
    }
    patch.objective = objective;
  }

  if (hasOwn(input, 'status')) {
    patch.status = runtimeThreadGoalStatus(input.status);
  }

  if (hasOwn(input, 'tokenBudget')) {
    if (input.tokenBudget !== null) {
      throw new RuntimeUseCaseError(
        'invalid_input',
        'Goal token budgets are no longer supported; omit tokenBudget or pass null.',
      );
    }
  }

  return patch;
}

export async function clearRuntimeThreadGoal(
  runtime: RuntimeContainer,
  threadId: string,
): Promise<Readonly<{ cleared: boolean; thread: RuntimeThread }>> {
  return runtime.agentLoop.withThreadMutation(threadId, async () => {
    const thread = await requireRuntimeThread(runtime, threadId);
    if (!await runtime.agentLoop.getThreadGoal(threadId)) return { cleared: false, thread };
    await runtime.agentLoop.clearThreadGoal(threadId);
    return { cleared: true, thread: await requireRuntimeThread(runtime, threadId) };
  });
}

export async function startRuntimeReview(
  runtime: RuntimeContainer,
  threadId: string,
  target: unknown,
  language?: unknown,
  modelSelection?: RuntimeConfiguredModelReference,
): Promise<RuntimeReviewStartResult> {
  let input: StartReviewInput;
  try {
    input = startReviewInputCodec.parse({
      threadId,
      target,
      language,
      ...(modelSelection ? { modelSelection } : {}),
    });
  } catch (error) {
    throw new RuntimeUseCaseError('invalid_input', runtimeUseCaseErrorMessage(error));
  }

  try {
    const started = await runtime.reviewControl.start(input);
    return {
      response: started.response,
      review: started.request,
    };
  } catch (error) {
    if (error instanceof RuntimeUseCaseError) throw error;
    if (error instanceof FeatureOperationFailure) {
      throw new RuntimeUseCaseError(
        error.code === 'THREAD_NOT_FOUND'
          ? 'thread_not_found'
          : error.code === 'INVALID_INPUT'
            ? 'invalid_input'
            : 'invalid_request',
        error.message,
        error.details,
      );
    }
    throw new RuntimeUseCaseError('invalid_request', runtimeUseCaseErrorMessage(error));
  }
}

function runtimeThreadGoalStatus(value: unknown): RuntimeThreadGoalStatus {
  if (
    value === 'active'
    || value === 'paused'
    || value === 'blocked'
    || value === 'usageLimited'
    || value === 'budgetLimited'
    || value === 'complete'
  ) {
    return value;
  }
  throw new RuntimeUseCaseError(
    'invalid_input',
    `Unsupported goal status: ${String(value)}`,
  );
}

function hasOwn(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
