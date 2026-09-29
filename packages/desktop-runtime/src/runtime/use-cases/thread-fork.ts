import type { ForkThreadInput, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import type { CreatedWorkspaceFork } from '../../ports/workspace-fork.js';
import type { RuntimeContainer } from '../runtime-factory.js';
import { RuntimeUseCaseError } from './errors.js';
import { copyRuntimeMessagesToThread } from './thread-copy.js';
import { runtimeMessagesThroughMessage } from './thread-fork-history.js';
import { requireRuntimeThread } from './thread-operations.js';

export async function forkRuntimeThread(
  runtime: RuntimeContainer,
  threadId: string,
  input: ForkThreadInput,
): Promise<RuntimeThread> {
  if (!input || typeof input.messageId !== 'string' || !input.messageId.trim()
    || (input.target !== 'workspace' && input.target !== 'worktree')) {
    throw new RuntimeUseCaseError('invalid_input', 'A messageId and a workspace or worktree target are required.');
  }
  // Keep attachments alive if deletion of the source is requested during the fork.
  return runtime.agentLoop.withThreadMutation(threadId, async () => {
    const source = await requireRuntimeThread(runtime, threadId);
    if (runtime.agentLoop.activeTurnId(threadId) || source.contextCompaction?.status === 'running') {
      throw new RuntimeUseCaseError('conflict', 'Wait for the current turn to finish before creating a branch.');
    }
    const messages = await runtimeMessagesThroughMessage(runtime.threadStore, source, input.messageId);
    let worktree: CreatedWorkspaceFork | undefined;
    try {
      if (input.target === 'worktree') {
        const environment = await runtime.environmentResolver.resolve({
          projectId: source.projectId, workspaceId: source.workspaceId, threadId, threadCreatedAt: source.createdAt,
        });
        if (!environment.repository) throw new RuntimeUseCaseError('invalid_request', 'A Git workspace is required to create a worktree.');
        worktree = await runtime.workspaceFork.createWorktree(environment.cwd);
      }
      return await copyRuntimeThread(runtime, source, messages, { workspaceId: worktree?.workspaceId });
    } catch (error) {
      // The new workspace has never been handed to the user, so only its own resources
      // may be removed. Successful worktrees keep their files independently of chats.
      const cleanup = await Promise.allSettled([
        ...(worktree ? [worktree.rollback()] : []),
      ]);
      const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) {
        throw new AggregateError([error, ...failures.map((failure) => failure.reason)],
          `Fork failed; cleanup was incomplete for ${worktree?.path ?? threadId}.`);
      }
      throw error;
    }
  });
}

export async function copyRuntimeThread(
  runtime: RuntimeContainer,
  source: RuntimeThread,
  messages: RuntimeMessage[],
  options: { workspaceId?: string; title?: string } = {},
): Promise<RuntimeThread> {
  const thread = await runtime.threadStore.createThread({
    title: options.title ?? source.title,
    projectId: source.projectId,
    workspaceId: options.workspaceId ?? source.workspaceId,
    forkedFromId: source.id,
    memoryMode: source.memoryMode,
    modelBinding: source.modelBinding ? { ...source.modelBinding } : undefined,
  });
  try {
    await runtime.attachmentStore.retainForThread(thread.id, messages.flatMap((message) => message.attachments ?? []));
    await copyRuntimeMessagesToThread(runtime, source.id, thread.id, messages, { preserveForkHistory: true });
    return await requireRuntimeThread(runtime, thread.id);
  } catch (error) {
    await Promise.allSettled([
      runtime.attachmentStore.releaseThread(thread.id),
      runtime.toolResultStore.releaseThread(thread.id),
      runtime.threadStore.deleteThread(thread.id),
    ]);
    throw error;
  }
}
