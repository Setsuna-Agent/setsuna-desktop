import { listLinkedDesigns } from './design-project-catalog.js';
import { createHash } from 'node:crypto';
import { mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isValidWorkspaceEntryName, WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { canAccessChatDesign, designDocumentCodec, designDocumentFileExtension, designImageFileExtensions, isDesignDocumentPath, isDesignLibraryPresetDocumentId, maxDesignShaderBytes,
  type DesignDocumentRef, type DesignImageExtension, type DesignWorkspace, type DesignWorkspaceFiles } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { isNodeError } from '../../shared/node-errors.js';
import { isPathWithin } from '../search/workspace-search-policy.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { writeTextFile } from '../store/json-file.js';
import { safeStorageFileStem } from '../store/storage-file-name.js';
import { createDesignCatalogFileReader } from './design-workspace-catalog-file.js';
import { designChanged, readDesignDocumentFile, readDesignFile, resolveDesignFile, withDesignSource, type DesignFile } from './design-workspace-document-file.js';
import { deleteDesignWorkspaceDocument, moveDesignWorkspaceDocument, removeUnchangedFile } from './design-workspace-document-mutations.js';
import { bindDesignResourcesForEdit, createDesignResourceOwnership, designResourceDirectory, designResourceRootUnavailable, readDraftId, resolveDesignResourceRoot } from './design-workspace-resource-root.js';
import { readVerifiedDesignImport, readWorkspaceDesignSource } from './design-workspace-source.js';
import { designStorageDirectories } from './design-storage-directories.js';
import { readWorkspaceFilePreview } from './workspace-file-preview-reader.js';
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
  const storage = designStorageDirectories(dataDir, projects);
  const startCatalogScan = createDesignCatalogFileReader();
  async function boundRoots() {
    const [projectsRoots, directories] = await Promise.all([projects.listBoundWorkspaceRoots(), storage.list()]);
    const paths = directories.map((directory) => directory.path);
    return { all: [...new Set([...projectsRoots.all, ...paths])], active: new Set([...projectsRoots.active, ...paths]), projectRoots: projectsRoots.active };
  }

  async function listDesignFiles<T extends { path: string }>(scope: DesignWorkspace, signal: AbortSignal,
    read: (file: string, relativePath: string, readCatalogFile: ReturnType<typeof startCatalogScan>['read']) => Promise<T | undefined>) {
    const root = await storage.resolve(scope);
    const scan = startCatalogScan(signal);
    const entries: T[] = [];
    await walkWorkspaceFiles(root, async (file) => {
      signal.throwIfAborted();
      if (isDesignDocumentPath(file)) {
        const entry = await read(file, path.relative(root, file).split(path.sep).join('/'), scan.read);
        if (entry) entries.push(entry);
      }
      return true;
    }, { signal });
    signal.throwIfAborted();
    scan.finish();
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  async function withDocumentSource<T>(ref: DesignDocumentRef, signal: AbortSignal,
    operation: (root: string, file: DesignFile, resourceRoots: readonly string[], projectBacked: boolean) => Promise<T>) {
    const [root, bindings] = await Promise.all([
      storage.resolve(ref), boundRoots(),
    ]);
    // Archived directories still share the file lock, but only roots available when opening can supply its resources.
    return withDesignSource(root, ref.path, bindings.all, undefined, signal, (file, enclosing) =>
      operation(root, file, enclosing.filter((candidate) => candidate === root || bindings.active.has(candidate)),
        isProjectDirectory(ref, root, bindings.projectRoots)));
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
      const revision = createHash('sha256').update(content).digest('hex');
      for (let ordinal = 1; ; ordinal += 1) {
        const filename = ordinal === 1 ? `${safeStem}.${extension}` : `${safeStem}-${ordinal}.${extension}`;
        const relativePath = `${designAssetDirectory}/${filename}`;
        const assetTarget = path.join(await resolveEntryParent(root, designAssetDirectory), filename);
        signal.throwIfAborted();
        let created: DesignFile['stats'] | undefined;
        try {
          created = await createWorkspaceFile(assetTarget, content);
        } catch (error) {
          // Try a new name only when exclusive creation found an existing entry.
          if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
          if (extension !== 'glsl') continue;
          const existing = await readWorkspaceDesignSource(root, relativePath, maxDesignShaderBytes).catch(() => undefined);
          signal.throwIfAborted();
          if (existing?.content !== content) continue;
        }
        try {
          await ownership.rememberImports(target, document.documentId, root, { [relativePath]: revision });
          return relativePath;
        } catch (error) {
          if (created) await removeUnchangedFile({ target: assetTarget, stats: created, root, relativePath, revision }).catch(() => undefined);
          throw error;
        }
      }
    });
  }

  return {
    async catalog(signal) {
      // The local watcher needs a real directory before the first chat-created draft is saved.
      const localRoot = storage.resolve({ storageId: 'local' }).catch(() => undefined);
      const [directories, associations] = await Promise.all([storage.list(), ownership.associations(signal), localRoot]);
      return { directories, associations: associations.map(({ file, projectId }) => ({ file, projectId })) };
    },
    projectDesigns: (projectId, signal) => listLinkedDesigns(projects, storage, ownership, projectId, signal),
    async setProject(ref, documentId, projectId, signal) {
      if (projectId !== null && !(await projects.listProjects()).projects.some((item) => item.id === projectId)) throw new Error('Unknown project.');
      await withDocumentSource(ref, signal, async (root, file, roots) => {
        const target = await realpath(file.target);
        const { document } = await readDesignDocumentFile(target, ref.path);
        if (document.documentId !== documentId) throw designChanged();
        const directory = await designResourceDirectory(root, target, document, roots, ownership, signal);
        // Retain access to the draft and its original resources if the old project is later removed.
        if (ref.projectId) await storage.remember(directory);
        const save = () => ownership.setProject(target, documentId, directory, projectId);
        if (relocateChats) await relocateChats({ source: target, target, documentId, linkedProject: projectId }, save);
        else await save();
      });
    },
    async searchImages(ref, query, signal) {
      const root = await storage.resolve(ref);
      await resolveDesignFile(root, ref.path);
      const paths: string[] = [];
      const needle = query.trim().toLowerCase();
      await walkWorkspaceFiles(root, (file) => {
        const entry = path.relative(root, file).split(path.sep).join('/');
        if (entry.split('/').every(isValidWorkspaceEntryName) && designImageFileExtensions.some((extension) => entry.toLowerCase().endsWith('.' + extension))
          && entry.toLowerCase().includes(needle)) paths.push(entry);
        return paths.length < 80;
      }, { signal });
      return paths;
    },
    async readImage(ref, assetPath, signal) {
      const root = await storage.resolve(ref);
      await resolveDesignFile(root, ref.path);
      const { target } = await resolveExistingWorkspaceEntry(root, assetPath);
      signal.throwIfAborted();
      const { preview } = await readWorkspaceFilePreview(target, assetPath);
      return preview?.kind === 'image' ? preview : null;
    },
    async list(scope, signal, chat) {
      const entries = await listDesignFiles(scope, signal, async (file, path, readCatalogFile) => {
        const id = chat ? await readDraftId(file).catch(() => undefined)
          : (await readCatalogFile(file).catch(() => undefined))?.documentId;
        if (isDesignLibraryPresetDocumentId(id)) return;
        if (chat) {
          if (!id) return;
          const linked = await ownership.project(file, id);
          if (!await canAccessChatDesign(chat, linked === undefined ? scope.projectId : linked, () => ownership.chatOrigin(file, id))) return;
        }
        return { path };
      });
      return entries.map(({ path }) => path);
    },
    listEntries: (scope, signal) => listDesignFiles(scope, signal, async (file, path, readCatalogFile) => {
      try {
        const entry = await readCatalogFile(file);
        if (!entry) return;
        const libraryPreset = isDesignLibraryPresetDocumentId(entry.documentId);
        const draftEntry = { path, modifiedAt: entry.modifiedAt };
        if (!scope.includePreviewMetadata) return libraryPreset ? undefined : draftEntry;
        return { ...draftEntry, revision: entry.revision, ...(libraryPreset ? { libraryPreset: true as const } : {}) };
      } catch (error) {
        // A file can disappear between the directory walk and the stat.
        if (!isNodeError(error) || (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')) return { path };
      }
    }),
    async create(input, content, signal, chat) {
      const root = await storage.resolve(input);
      const { autoNumber, linkedProjectId, name: requestedName } = input;
      if (!isValidWorkspaceEntryName(requestedName)) throw new Error('Invalid design file name.');
      if (linkedProjectId && !(await projects.listProjects()).projects.some(({ id }) => id === linkedProjectId)) throw new Error('Unknown project.');
      const { documentId } = designDocumentCodec.parse(JSON.parse(content));
      return withFileStateUpdate(root, async () => {
        const parent = await resolveEntryParent(root, input.parentPath);
        const existing = autoNumber ? new Set(await readdir(parent)) : undefined;
        const extensionStart = requestedName.length - designDocumentFileExtension.length - 1;
        const stem = requestedName.slice(0, extensionStart);
        const extension = requestedName.slice(extensionStart);
        for (let ordinal = 1; ; ordinal += 1) {
          signal.throwIfAborted();
          const name = ordinal === 1 ? requestedName : `${stem} ${ordinal}${extension}`;
          if (existing?.has(name)) continue;
          const target = path.join(parent, name);
          if (chat) await ownership.setProject(target, documentId, root, chat.projectId ?? null, chat.threadId);
          else if (linkedProjectId || (input.storageId && input.storageId !== 'local')) {
            await ownership.setProject(target, documentId, root, linkedProjectId ?? null);
          } else await ownership.remember(target, documentId, root);
          try {
            signal.throwIfAborted();
            await createWorkspaceFile(target, content);
            return { name, path: path.relative(root, target).split(path.sep).join('/'), type: 'file' };
          } catch (error) {
            await ownership.forget(target, documentId).catch(() => undefined);
            if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
            // Exclusive creation still handles entries added after the directory scan.
            if (autoNumber) continue;
            throw new FeatureOperationFailure({
              code: WORKSPACE_ENTRY_EXISTS_ERROR_CODE, message: 'A file or folder with that name already exists.', retryable: false,
            });
          }
        }
      });
    },
    async move({ ref, destination, expectedRevision }, signal) {
      const [sourceRoot, destinationRoot, roots] = await Promise.all([
        storage.resolve(ref),
        storage.resolve(destination),
        boundRoots(),
      ]);
      const allowPresetLibraries = isProjectDirectory(destination, destinationRoot, roots.projectRoots);
      const name = await moveDesignWorkspaceDocument(sourceRoot, ref.path, destinationRoot, roots.all, ownership, signal,
        { expectedRevision, sourceProject: ref.projectId ?? null, relocateChats, allowPresetLibraries });
      return { ...destination, path: name };
    },
    async delete(ref, signal) {
      const [root, roots] = await Promise.all([
        storage.resolve(ref), boundRoots(),
      ]);
      await deleteDesignWorkspaceDocument(root, ref.path, roots.all, ownership, signal, ref.expectedRevision, relocateChats);
    },
    async resolveResourceRoot(ref, signal) {
      const [root, listing, directories] = await Promise.all([
        storage.resolve(ref), projects.listProjects(), storage.list(),
      ]);
      return resolveDesignResourceRoot(ref, root, listing.projects, ownership, signal, directories);
    },
    async readSource(ref, assetPath, maxBytes, signal) {
      signal.throwIfAborted();
      const root = await storage.resolve(ref);
      await resolveDesignFile(root, ref.path);
      const file = await readWorkspaceDesignSource(root, assetPath, maxBytes);
      signal.throwIfAborted();
      return file.content;
    },
    importImage: (ref, { name, extension, bytes }, signal) => importAsset(ref, { name, extension, content: bytes }, signal),
    importSource: (ref, { name, source, extension }, signal) => importAsset(ref, { name, extension, content: source }, signal),
    async withDocument(ref, signal, operation) {
      return withDocumentSource(ref, signal, async (root, { target, stats }, roots, projectBacked) => {
        const key = await realpath(target);
        const read = async () => {
          signal.throwIfAborted();
          return readDesignFile(target, ref.path);
        };
        return operation({
          key, workspaceRoot: root, projectBacked,
          async importedAssets(id, accept) {
            const paths: string[] = [];
            for (const [path, revision] of Object.entries(await ownership.imports(key, id))) {
              signal.throwIfAborted();
              if (accept(path) && await readVerifiedDesignImport(root, path, revision)) paths.push(path);
            }
            signal.throwIfAborted();
            return paths;
          },
          chatOrigin: (id) => ownership.chatOrigin(key, id),
          linkedProject: (id) => ownership.project(key, id),
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

function isProjectDirectory(scope: DesignWorkspace, directory: string, projectRoots: ReadonlySet<string>) {
  if (scope.projectId) return true;
  for (const root of projectRoots) if (isPathWithin(root, directory)) return true;
  return false;
}
