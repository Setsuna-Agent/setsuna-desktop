import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isValidWorkspaceEntryName, workspaceTarget, WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { designDocumentCodec, isDesignDocumentPath, maxDesignShaderBytes,
  type DesignDocumentRef, type DesignImageExtension, type DesignWorkspaceFiles } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { isNodeError } from '../../shared/node-errors.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { writeTextFile } from '../store/json-file.js';
import { safeStorageFileStem } from '../store/storage-file-name.js';
import { designChanged, readDesignDocumentFile, readDesignFile, resolveDesignFile, withDesignSource, type DesignFile } from './design-workspace-document-file.js';
import { deleteDesignWorkspaceDocument, moveDesignWorkspaceDocument } from './design-workspace-document-mutations.js';
import { bindDesignResourcesForEdit, createDesignResourceOwnership, designResourceDirectory, designResourceRootUnavailable, resolveDesignResourceRoot } from './design-workspace-resource-root.js';
import { readWorkspaceDesignSource } from './design-workspace-source.js';
import type { FileWorkspaceProjectStore } from './file-workspace-project-store.js';
import { createWorkspaceFile, resolveEntryParent, resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';
import { walkWorkspaceFiles } from './workspace-file-walk.js';
import type { DesignConversationRelocation } from './design-conversation-relocation.js';

const designAssetDirectory = 'design-assets';

export function createDesignWorkspaceFiles(
  projects: Pick<FileWorkspaceProjectStore, 'resolveWorkspaceRoot' | 'listBoundWorkspaceRoots' | 'listProjects'>, dataDir: string,
  relocateChats?: DesignConversationRelocation,
): DesignWorkspaceFiles {
  const ownership = createDesignResourceOwnership(dataDir);

  async function withDocumentSource<T>(ref: DesignDocumentRef, signal: AbortSignal,
    operation: (root: string, file: DesignFile, resourceRoots: readonly string[]) => Promise<T>) {
    const [root, bindings] = await Promise.all([
      projects.resolveWorkspaceRoot(workspaceTarget(ref.projectId, ref.rootId)), projects.listBoundWorkspaceRoots(),
    ]);
    // Archived directories still share the file lock, but only roots available when opening can supply its resources.
    return withDesignSource(root, ref.path, bindings.all, undefined, signal, (file, enclosing) =>
      operation(root, file, enclosing.filter((candidate) => candidate === root || bindings.active.has(candidate))));
  }

  async function importAsset(ref: DesignDocumentRef, asset: Readonly<{
    name: string; extension: DesignImageExtension | 'js' | 'glsl'; content: string | Uint8Array;
  }>, signal: AbortSignal) {
    return withDocumentSource(ref, signal, async (root, file, roots) => {
      const target = await realpath(file.target);
      const { document } = await readDesignDocumentFile(target, ref.path);
      const sourceRoot = await designResourceDirectory(root, target, document, roots, ownership, signal);
      if (path.relative(root, sourceRoot)) throw designResourceRootUnavailable();
      await ownership.remember(target, document.documentId, root);
      signal.throwIfAborted();
      try {
        await mkdir(path.join(root, designAssetDirectory));
      } catch (error) {
        if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      }
      const directory = await resolveExistingWorkspaceEntry(root, designAssetDirectory);
      if (!directory.stats.isDirectory()) throw new Error('The design assets location must be a directory.');

      const { name, extension, content } = asset;
      const fallback = extension === 'js' ? 'script' : extension === 'glsl' ? 'shader' : 'image';
      const stem = safeStorageFileStem(path.parse(name).name.replace(/^\.+/u, ''), fallback);
      const safeStem = isValidWorkspaceEntryName(`${stem}.${extension}`) ? stem : `_${stem}`;
      for (let ordinal = 1; ; ordinal += 1) {
        const filename = ordinal === 1 ? `${safeStem}.${extension}` : `${safeStem}-${ordinal}.${extension}`;
        const relativePath = `${designAssetDirectory}/${filename}`;
        try {
          const parent = await resolveEntryParent(root, designAssetDirectory);
          signal.throwIfAborted();
          await createWorkspaceFile(path.join(parent, filename), content);
          return relativePath;
        } catch (error) {
          // Try a new name only when exclusive creation found an existing entry.
          if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
          if (extension === 'glsl') {
            const existing = await readWorkspaceDesignSource(root, relativePath, maxDesignShaderBytes).catch(() => undefined);
            signal.throwIfAborted();
            if (existing?.content === content) return relativePath;
          }
        }
      }
    });
  }

  return {
    async list({ projectId, rootId }, signal) {
      const root = await projects.resolveWorkspaceRoot(workspaceTarget(projectId, rootId));
      const paths: string[] = [];
      await walkWorkspaceFiles(root, (file) => {
        if (isDesignDocumentPath(file)) paths.push(path.relative(root, file).split(path.sep).join('/'));
        return true;
      }, { signal });
      signal.throwIfAborted();
      return paths.sort((a, b) => a.localeCompare(b));
    },
    async create(input, content, signal) {
      const root = await projects.resolveWorkspaceRoot(workspaceTarget(input.projectId, input.rootId));
      const { name } = input;
      if (!isValidWorkspaceEntryName(name)) throw new Error('Invalid design file name.');
      const { documentId } = designDocumentCodec.parse(JSON.parse(content));
      return withFileStateUpdate(root, async () => {
        const parent = await resolveEntryParent(root, input.parentPath);
        const target = path.join(parent, name);
        signal.throwIfAborted();
        await ownership.remember(target, documentId, root);
        try {
          signal.throwIfAborted();
          await createWorkspaceFile(target, content);
          return { name, path: path.relative(root, target).split(path.sep).join('/'), type: 'file' };
        } catch (error) {
          await ownership.forget(target, documentId).catch(() => undefined);
          if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
          throw new FeatureOperationFailure({
            code: WORKSPACE_ENTRY_EXISTS_ERROR_CODE, message: 'A file or folder with that name already exists.', retryable: false,
          });
        }
      });
    },
    async move({ ref, destination, expectedRevision }, signal) {
      const [sourceRoot, destinationRoot, boundRoots] = await Promise.all([
        projects.resolveWorkspaceRoot(workspaceTarget(ref.projectId, ref.rootId)),
        projects.resolveWorkspaceRoot(workspaceTarget(destination.projectId, destination.rootId)),
        projects.listBoundWorkspaceRoots(),
      ]);
      const name = await moveDesignWorkspaceDocument(sourceRoot, ref.path, destinationRoot, boundRoots.all, ownership, signal,
        { expectedRevision, projectAtDestination: () => destination.projectId, relocateChats });
      return { ...destination, path: name };
    },
    async delete(ref, signal) {
      const [root, boundRoots] = await Promise.all([
        projects.resolveWorkspaceRoot(workspaceTarget(ref.projectId, ref.rootId)), projects.listBoundWorkspaceRoots(),
      ]);
      await deleteDesignWorkspaceDocument(root, ref.path, boundRoots.all, ownership, signal, ref.expectedRevision, relocateChats);
    },
    async resolveResourceRoot(ref, signal) {
      const [root, listing] = await Promise.all([
        projects.resolveWorkspaceRoot(workspaceTarget(ref.projectId, ref.rootId)), projects.listProjects(),
      ]);
      return resolveDesignResourceRoot(ref, root, listing.projects, ownership, signal);
    },
    async readSource(ref, assetPath, maxBytes, signal) {
      signal.throwIfAborted();
      const root = await projects.resolveWorkspaceRoot(workspaceTarget(ref.projectId, ref.rootId));
      await resolveDesignFile(root, ref.path);
      const file = await readWorkspaceDesignSource(root, assetPath, maxBytes);
      signal.throwIfAborted();
      return file.content;
    },
    importImage: (ref, { name, extension, bytes }, signal) => importAsset(ref, { name, extension, content: bytes }, signal),
    importSource: (ref, { name, source, extension }, signal) => importAsset(ref, { name, extension, content: source }, signal),
    async withDocument(ref, signal, operation) {
      return withDocumentSource(ref, signal, async (root, { target, stats }, roots) => {
        const key = await realpath(target);
        const read = async () => {
          signal.throwIfAborted();
          return readDesignFile(target, ref.path);
        };
        return operation({
          key,
          read,
          async replace(content, expectedRevision, previous, next) {
            const added = await bindDesignResourcesForEdit(root, key, previous, next, roots, ownership, signal);
            try {
              await writeTextFile(target, content, {
                mode: stats.mode & 0o777,
                // Check again after staging the file, including on Windows rename retries.
                beforeReplace: async () => {
                  const current = await resolveDesignFile(root, ref.path);
                  if (current.target !== target || (await read()).revision !== expectedRevision) throw designChanged();
                  signal.throwIfAborted();
                },
              });
            } catch (error) {
              if (added) await ownership.forget(key, previous.documentId);
              throw error;
            }
            return createHash('sha256').update(content).digest('hex');
          },
        });
      });
    },
  };
}
