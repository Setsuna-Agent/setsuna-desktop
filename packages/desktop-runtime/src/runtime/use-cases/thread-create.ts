import type { CreateThreadInput, RuntimeThread } from '@setsuna-desktop/contracts';
import type { RuntimeContainer } from '../runtime-factory.js';
import type { ThreadStoreCreateInput } from '../../ports/thread-store.js';
import { RuntimeUseCaseError } from './errors.js';

/** Resolve creation-only workspace choices before persisting the chat's binding. */
export async function createRuntimeThread(runtime: RuntimeContainer, input: CreateThreadInput): Promise<RuntimeThread> {
  if (input.workspaceMode !== undefined && input.workspaceMode !== 'local' && input.workspaceMode !== 'worktree') {
    throw new RuntimeUseCaseError('invalid_input', 'workspaceMode must be local or worktree.');
  }
  const settings = await runtime.agentLoop.memoryControl().readSettings().catch(() => null);
  const threadInput: ThreadStoreCreateInput = {
    title: input.title,
    projectId: input.projectId,
    forkedFromId: input.forkedFromId,
    parentThreadId: input.parentThreadId,
    memoryMode: input.memoryMode ?? (settings?.value.generateMemories ? 'enabled' : 'disabled'),
  };
  if (input.workspaceMode !== 'worktree') return runtime.threadStore.createThread(threadInput);

  if (!input.projectId) throw new RuntimeUseCaseError('invalid_request', 'A Git project is required to create a worktree.');
  const status = await runtime.workspaceProjects.getStatus(input.projectId);
  if (!status.project?.path || !status.gitRoot || !status.exists || !status.readable) {
    throw new RuntimeUseCaseError('invalid_request', 'An available Git project is required to create a worktree.');
  }
  const worktree = await runtime.workspaceFork.createWorktree(status.project.path, status.project);
  try {
    return await runtime.threadStore.createThread({ ...threadInput, workspaceId: worktree.workspaceId });
  } catch (error) {
    // Nothing has been exposed to the user yet; a failed chat insert must not leave a worktree behind.
    try { await worktree.rollback(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Chat creation failed; cleanup also failed at ${worktree.path}.`);
    }
    throw error;
  }
}
