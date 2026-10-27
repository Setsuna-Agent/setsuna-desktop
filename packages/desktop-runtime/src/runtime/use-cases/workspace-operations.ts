import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type WorkspaceFileRead,
  type WorkspaceProjectTarget,
  type WorkspaceFileSaveInput,
} from '@setsuna-desktop/contracts';
import { Buffer } from 'node:buffer';
import type { WorkspaceProjectStore } from '../../ports/workspace-project-store.js';
import type { ThreadStorePatch } from '../../ports/thread-store.js';
import { readRuntimeThreadMetadata } from '../thread-metadata.js';
import type { RuntimeContainer } from '../runtime-factory.js';
import { RuntimeUseCaseError } from './errors.js';

type RuntimeWorkspaceOperations = Pick<
  RuntimeContainer,
  'agentLoop' | 'threadStore' | 'workspaceProjects'
>;

/**
 * Archives a workspace only after every active project thread has committed
 * its own archived state. The REST adapter only parses the project identity.
 */
export async function archiveRuntimeWorkspaceProject(
  runtime: RuntimeWorkspaceOperations,
  projectId: string,
): Promise<void> {
  const projectThreads = await runtime.threadStore.listThreads({
    includeFeatures: true,
    includeArchived: true,
    projectId,
  });

  // Keep thread mutations serialized by their existing owner. If one fails,
  // the project remains visible so the operation can be retried safely.
  for (const thread of projectThreads) {
    if (thread.archived) continue;
    await runtime.agentLoop.withThreadMutation(
      thread.id,
      () => runtime.threadStore.updateThread(thread.id, { archived: true }),
    );
  }

  await runtime.workspaceProjects.archiveProject(projectId);
}

/** Preserve an archived project's identity; only a removed project loses ownership. */
export async function restoredThreadProjectPatch(
  workspaceProjects: Pick<WorkspaceProjectStore, 'restoreProject'>,
  projectId: string | undefined,
): Promise<Pick<ThreadStorePatch, 'projectId'>> {
  if (!projectId) return {};
  return await workspaceProjects.restoreProject(projectId) ? {} : { projectId: null };
}

export async function removeRuntimeWorkspaceProject(
  runtime: RuntimeWorkspaceOperations & Pick<RuntimeContainer, 'eventBus'>,
  projectId: string,
): Promise<void> {
  const threads = await runtime.threadStore.listThreads({
    includeFeatures: true, includeSide: true, includeArchived: true, projectId,
  });
  const assertIdle = (threadId: string) => {
    if (runtime.agentLoop.activeTurnId(threadId)) {
      throw new RuntimeUseCaseError('conflict', 'Wait for project conversations to finish before removing the project.');
    }
  };
  // Check the whole project before moving anything, then recheck inside each admission boundary.
  threads.forEach((thread) => assertIdle(thread.id));
  for (const thread of threads) {
    await runtime.agentLoop.withThreadMutation(thread.id, async () => {
      assertIdle(thread.id);
      const current = await readRuntimeThreadMetadata(runtime.threadStore, thread.id);
      if (!current || current.projectId !== projectId) return;
      await runtime.threadStore.updateThread(thread.id, { projectId: null });
      const events = await runtime.threadStore.listEvents(thread.id, current.lastSeq);
      for (const event of events) runtime.eventBus.publish(event);
    });
  }
  // Keep the project available if a move fails; retrying only visits remaining members.
  await runtime.workspaceProjects.removeProject(projectId);
}

/**
 * Save a user-edited text file only when it still matches the revision that
 * was originally displayed. The REST layer delegates here so the safety rule
 * remains transport-independent.
 */
export async function saveRuntimeWorkspaceFile(
  workspaceProjects: Pick<WorkspaceProjectStore, 'readFile' | 'writeFile'>,
  projectId: WorkspaceProjectTarget,
  relativePath: string,
  input: WorkspaceFileSaveInput,
): Promise<WorkspaceFileRead> {
  if (typeof input.content !== 'string') {
    throw new RuntimeUseCaseError('invalid_input', 'File content must be a string.');
  }
  if (typeof input.expectedRevision !== 'string' || !input.expectedRevision.trim()) {
    throw new RuntimeUseCaseError('invalid_input', 'File revision is required.');
  }
  if (Buffer.byteLength(input.content, 'utf8') > WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES) {
    throw new RuntimeUseCaseError(
      'invalid_input',
      `Edited files must not exceed ${WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES} bytes.`,
    );
  }

  const current = await workspaceProjects.readFile(projectId, relativePath);
  if (current.preview?.kind !== 'text' || current.size > WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES) {
    throw new RuntimeUseCaseError('invalid_request', 'Only supported text files can be edited.');
  }
  if (!current.revision || current.revision !== input.expectedRevision) {
    throw new RuntimeUseCaseError(
      'conflict',
      'The file changed on disk. Reload it before saving your edits.',
      { reason: 'workspace_file_changed', revision: current.revision },
    );
  }

  await workspaceProjects.writeFile(projectId, current.path, input.content);
  return workspaceProjects.readFile(projectId, current.path, {
    maxTextBytes: WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  });
}
