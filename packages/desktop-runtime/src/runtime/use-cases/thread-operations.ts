import type {
  RuntimeReviewTarget,
  RuntimeThread,
  RuntimeThreadGoalClearResponse,
  RuntimeThreadGoalPatch,
  RuntimeThreadGoalSetResponse,
  RuntimeThreadGoalStatus,
  SendTurnResponse,
} from '@setsuna-desktop/contracts';
import type { RuntimeReviewTurnInput } from '../../loop/core/runtime-turn-run-factory.js';
import type { RuntimeContainer } from '../runtime-factory.js';
import { randomRuntimeId } from '../runtime-id.js';
import { RuntimeUseCaseError, runtimeUseCaseErrorMessage } from './errors.js';

export type RuntimeReviewStartResult = {
  response: SendTurnResponse;
  review: RuntimeReviewTurnInput;
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
 */
export async function deleteRuntimeThread(
  runtime: RuntimeContainer,
  threadId: string,
): Promise<void> {
  await runtime.agentLoop.withThreadDeletionBarrier(threadId, async () => {
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
      { label: 'MCP connections', run: () => runtime.mcpConnections.releaseThread(threadId) },
      { label: 'attachments', run: () => runtime.attachmentStore.releaseThread(threadId) },
      ...(!thread.projectId
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
): Promise<RuntimeThreadGoalSetResponse> {
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
): Promise<RuntimeThreadGoalClearResponse> {
  return runtime.agentLoop.withThreadMutation(threadId, async () => {
    const thread = await requireRuntimeThread(runtime, threadId);
    if (!thread.goal) return { cleared: false, thread };
    await runtime.agentLoop.clearThreadGoal(threadId);
    return { cleared: true, thread: await requireRuntimeThread(runtime, threadId) };
  });
}

export function runtimeReviewRequestFromTarget(value: unknown): RuntimeReviewTurnInput {
  const target = runtimeReviewTarget(value);
  if (target.type === 'uncommittedChanges') {
    return {
      displayText: 'current changes',
      prompt: runtimeReviewPrompt('Review the current uncommitted changes.'),
    };
  }
  if (target.type === 'baseBranch') {
    const branch = requiredReviewText(target.branch, 'branch');
    return {
      displayText: `changes against '${branch}'`,
      prompt: runtimeReviewPrompt(`Review the changes between the current branch and '${branch}'.`),
    };
  }
  if (target.type === 'commit') {
    const sha = requiredReviewText(target.sha, 'sha');
    const title = optionalReviewText(target.title);
    const shortSha = [...sha].slice(0, 7).join('');
    return {
      displayText: title ? `commit ${shortSha}: ${title}` : `commit ${shortSha}`,
      prompt: runtimeReviewPrompt(title ? `Review commit ${sha}: ${title}.` : `Review commit ${sha}.`),
    };
  }
  const instructions = requiredReviewText(target.instructions, 'instructions');
  return { displayText: instructions, prompt: instructions };
}

export async function startRuntimeReview(
  runtime: RuntimeContainer,
  threadId: string,
  target: unknown,
): Promise<RuntimeReviewStartResult> {
  await requireRuntimeThread(runtime, threadId);
  const review = runtimeReviewRequestFromTarget(target);
  try {
    return {
      response: await runtime.agentLoop.startReview(threadId, review),
      review,
    };
  } catch (error) {
    if (error instanceof RuntimeUseCaseError) throw error;
    throw new RuntimeUseCaseError('invalid_request', runtimeUseCaseErrorMessage(error));
  }
}

function runtimeReviewTarget(value: unknown): RuntimeReviewTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeUseCaseError('invalid_input', 'Missing required parameter: target.type');
  }
  const target = value as Record<string, unknown>;
  const type = optionalReviewText(target.type);
  if (!type) {
    throw new RuntimeUseCaseError('invalid_input', 'Missing required parameter: target.type');
  }
  if (type === 'uncommittedChanges') return { type };
  if (type === 'baseBranch') return { type, branch: requiredReviewText(target.branch, 'branch') };
  if (type === 'commit') {
    const title = optionalReviewText(target.title);
    return {
      type,
      sha: requiredReviewText(target.sha, 'sha'),
      ...(title ? { title } : {}),
    };
  }
  if (type === 'custom') {
    return { type, instructions: requiredReviewText(target.instructions, 'instructions') };
  }
  throw new RuntimeUseCaseError('invalid_input', `Unsupported review target: ${type}`);
}

function runtimeReviewPrompt(scope: string): string {
  return `${scope}\nInspect the relevant diff and return the review findings.`;
}

function requiredReviewText(value: unknown, name: string): string {
  const text = optionalReviewText(value);
  if (text) return text;
  throw new RuntimeUseCaseError('invalid_request', `${name} must not be empty`);
}

function optionalReviewText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
