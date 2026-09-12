import type { ThreadFileChangesInput, ThreadFileChangesResult, WorkspaceFileChange, WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { isFileChangePatch } from '../../utils/file-change-patch.js';
import type { RuntimeContainer } from '../runtime-factory.js';
import { RuntimeUseCaseError } from './errors.js';

type FileChangesRuntime = {
  agentLoop: Pick<RuntimeContainer['agentLoop'], 'withThreadMutation' | 'activeTurnId'>;
  threadStore: Pick<RuntimeContainer['threadStore'], 'getThread'>;
  workspaceProjects: Pick<RuntimeContainer['workspaceProjects'], 'ensureTemporaryWorkspace' | 'applyFileChanges'>;
};

/** Resolve authoritative tool results on the server for both undo and reapply. */
export async function applyThreadFileChanges(
  runtime: FileChangesRuntime,
  threadId: string,
  input: ThreadFileChangesInput,
  action: WorkspaceFileChangeAction,
): Promise<ThreadFileChangesResult> {
  if (action !== 'undo' && action !== 'redo') {
    throw new RuntimeUseCaseError('invalid_input', 'File change action must be undo or redo.');
  }
  if (!Array.isArray(input?.toolCallIds) || !input.toolCallIds.length
    || input.toolCallIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new RuntimeUseCaseError('invalid_input', 'Tool call ids are required.');
  }
  return runtime.agentLoop.withThreadMutation(threadId, async () => {
    if (runtime.agentLoop.activeTurnId(threadId)) {
      throw new RuntimeUseCaseError('conflict', 'Wait for this conversation to finish before undoing or reapplying file changes.');
    }
    const thread = await runtime.threadStore.getThread(threadId);
    if (!thread) throw new RuntimeUseCaseError('thread_not_found', 'Thread not found.');
    const requested = new Set(input.toolCallIds);
    const runs = thread.messages.flatMap((message) => message.toolRuns ?? [])
      .filter((run) => requested.has(run.id));
    if (runs.length !== requested.size || runs.some((run) => run.status !== 'success')) {
      throw new RuntimeUseCaseError('invalid_request', 'Only completed file operations from this conversation can be undone or reapplied.');
    }
    // Parallel tools can finish in a different order from their tool-call array.
    runs.sort((left, right) => (left.completedAt ?? '').localeCompare(right.completedAt ?? ''));
    const changes = runs.flatMap((run): WorkspaceFileChange[] => {
      const result = record(run.data);
      const diff = record(result?.diff);
      const diffs = Array.isArray(diff?.diffs) ? diff.diffs : [diff];
      if (!result?.ok || !diffs.length) throw unavailableChange();
      return diffs.map((value) => {
        const file = record(value);
        if (!file || file.partial || typeof file.path !== 'string' || !isFileChangePatch(file.undo)) throw unavailableChange();
        return { path: file.path, patch: file.undo };
      });
    });
    const projectId = thread.projectId ?? (await runtime.workspaceProjects.ensureTemporaryWorkspace({
      threadId, createdAt: thread.createdAt,
    })).id;
    await runtime.workspaceProjects.applyFileChanges(projectId, changes, action);
    return { files: [...new Set(changes.map((change) => change.path))] };
  });
}

function unavailableChange(): RuntimeUseCaseError {
  return new RuntimeUseCaseError('invalid_request', 'This operation has no complete change record for lossless restoration. No files were changed.');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
