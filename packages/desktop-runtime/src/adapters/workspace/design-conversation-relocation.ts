import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { workspaceFilePathKey, type RuntimeThreadOrigin } from '@setsuna-desktop/contracts';
import type { ThreadStore } from '../../ports/thread-store.js';
import { isNodeError } from '../../shared/node-errors.js';
import { readDraftId } from './design-workspace-resource-root.js';

export function designConversationOwnerKey(root: string, relativePath: string, documentId: string) {
  return JSON.stringify([workspaceFilePathKey(root, relativePath), documentId]);
}

export type DesignDestinationProject = (ownerProjectId: string, destinationFile: string, sourceFile: string, documentId: string) => string | null | Promise<string | null>;
type Change = { source: string; target: string | null; documentId?: string; projectAtDestination?: DesignDestinationProject; linkedProject?: string | null };
export type DesignConversationRelocation = (change: Change, commit: () => Promise<void>) => Promise<void>;

export function createDesignConversationRelocation(store: Pick<ThreadStore, 'listThreads'>,
  updateOwner: (threadId: string, origin: RuntimeThreadOrigin, projectId: string | null) => Promise<unknown>): DesignConversationRelocation {
  return async ({ source, target, documentId, projectAtDestination, linkedProject }, commit) => {
    const threads = await store.listThreads({ featureId: 'design', includeFeatures: true, includeArchived: true });
    const sourceKey = workspaceFilePathKey(path.dirname(source), path.basename(source));
    const targetKey = target === null ? null : workspaceFilePathKey(path.dirname(target), path.basename(target));
    const moved: { id: string; origin: RuntimeThreadOrigin; projectId: string | null; file: string }[] = [];
    const draftIds = new Map<string, string | undefined>();
    let deleting = false;
    try {
      for (const { id, origin, featureId, projectId } of threads) {
        if (featureId !== 'design' || origin?.featureId !== 'design' || !origin.entityId) continue;
        const [file, draftId] = parseOwner(origin.entityId);
        if (!draftId) continue;
        const fromSource = file === sourceKey || file.startsWith(sourceKey + '/');
        const atDestination = targetKey && targetKey !== sourceKey && (file === targetKey || file.startsWith(targetKey + '/'));
        if (!fromSource && !atDestination) continue;
        const relative = fromSource ? file.slice(sourceKey.length + 1) : '';
        if (fromSource && workspaceFilePathKey(source, relative || '.') !== file) continue;
        // Removing a path retires its bindings, including ones for unreadable or replaced drafts.
        let nextOwner: string | null = null;
        let nextProject = projectId ?? null;
        // A destination deleted outside the app can still own chats belonging to the previous copy.
        if (fromSource && target !== null) {
          if (documentId === undefined) {
            if (!draftIds.has(file)) draftIds.set(file, await readDraftId(file));
            if (draftIds.get(file) !== draftId) continue;
          } else if (file !== sourceKey || draftId !== documentId) continue;
          nextOwner = designConversationOwnerKey(target, relative || '.', draftId);
          if (linkedProject !== undefined) nextProject = linkedProject;
          else if (projectAtDestination && projectId) nextProject = await projectAtDestination(projectId, path.join(target, relative), file, draftId);
        }
        if (nextOwner === origin.entityId && nextProject === (projectId ?? null)) continue;
        await updateOwner(id, { featureId, entityId: nextOwner }, nextProject);
        moved.push({ id, origin, projectId: projectId ?? null, file });
      }
      // The workspace lock covers both ownership updates and the filesystem commit.
      deleting = target === null;
      await commit();
    } catch (error) {
      for (const thread of moved.reverse()) {
        // A recursive removal may fail after deleting some children. Only restore bindings for paths that still exist.
        if (deleting && await removedPath(thread.file)) continue;
        await updateOwner(thread.id, thread.origin, thread.projectId);
      }
      throw error;
    }
  };
}

async function removedPath(file: string) {
  return lstat(file).then(() => false, (error: unknown) => isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR'));
}

function parseOwner(key: string): string[] {
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'string')) return value;
  } catch { /* Older feature origins may be opaque identifiers. */ }
  return [];
}
