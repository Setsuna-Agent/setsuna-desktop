import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { workspaceFilePathKey, type RuntimeThreadOrigin } from '@setsuna-desktop/contracts';
import type { ThreadStore } from '../../ports/thread-store.js';
import { isNodeError } from '../../shared/node-errors.js';
import { readDraftId } from './design-workspace-resource-root.js';

export function designConversationOwnerKey(root: string, relativePath: string, documentId: string) {
  return JSON.stringify([workspaceFilePathKey(root, relativePath), documentId]);
}

export type DesignDestinationProject = (ownerProjectId: string, destinationFile: string) => string | Promise<string>;
type Change = { source: string; target: string | null; documentId?: string; projectAtDestination?: DesignDestinationProject };
export type DesignConversationRelocation = (change: Change, commit: () => Promise<void>) => Promise<void>;

export function createDesignConversationRelocation(store: Pick<ThreadStore, 'listThreads'>,
  updateOwner: (threadId: string, origin: RuntimeThreadOrigin, projectId: string) => Promise<unknown>): DesignConversationRelocation {
  return async ({ source, target, documentId, projectAtDestination }, commit) => {
    const threads = await store.listThreads({ featureId: 'design', includeFeatures: true, includeArchived: true });
    const sourceKey = workspaceFilePathKey(path.dirname(source), path.basename(source));
    const moved: { id: string; origin: RuntimeThreadOrigin; projectId: string; file: string }[] = [];
    const draftIds = new Map<string, string | undefined>();
    let deleting = false;
    try {
      for (const { id, origin, featureId, projectId } of threads) {
        if (!projectId || featureId !== 'design' || origin?.featureId !== 'design' || !origin.entityId) continue;
        const [file, draftId] = parseOwner(origin.entityId);
        if (!draftId || (file !== sourceKey && !file.startsWith(sourceKey + '/'))) continue;
        const relative = file.slice(sourceKey.length + 1);
        if (workspaceFilePathKey(source, relative || '.') !== file) continue;
        // Removing a path retires its bindings, including ones for unreadable or replaced drafts.
        let nextOwner: string | null = null;
        let nextProject = projectId;
        if (target !== null) {
          if (documentId === undefined) {
            if (!draftIds.has(file)) draftIds.set(file, await readDraftId(file));
            if (draftIds.get(file) !== draftId) continue;
          } else if (file !== sourceKey || draftId !== documentId) continue;
          nextOwner = designConversationOwnerKey(target, relative || '.', draftId);
          if (projectAtDestination) nextProject = await projectAtDestination(projectId, path.join(target, relative));
        }
        if (nextOwner === origin.entityId && nextProject === projectId) continue;
        await updateOwner(id, { featureId, entityId: nextOwner }, nextProject);
        moved.push({ id, origin, projectId, file });
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
