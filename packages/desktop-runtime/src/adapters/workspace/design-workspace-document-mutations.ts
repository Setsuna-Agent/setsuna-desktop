import { lstat, mkdir, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isValidWorkspaceEntryName, workspaceFilePathKey, WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { designDocumentImagePaths, designLayerShaderPaths, designLibraryFileLinks, findBundledDesignLibrary, isDesignDocumentPath, isDesignLibraryPresetDocumentId,
  maxDesignScriptBytes, maxDesignShaderBytes, type DesignDocument } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure, isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import { isNodeError } from '../../shared/node-errors.js';
import { designChanged, readDesignDocumentFile, readValidDesignDocument,
  resolveDesignFile, withDesignSource, type DesignFile } from './design-workspace-document-file.js';
import { designResourceDirectory, type DesignResourceOwnership } from './design-workspace-resource-root.js';
import { readVerifiedDesignImport, readWorkspaceDesignSource } from './design-workspace-source.js';
import { createWorkspaceFile, resolveEntryParent, resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';
import { readWorkspaceFilePreview } from './workspace-file-preview-reader.js';
import { walkWorkspaceFiles } from './workspace-file-walk.js';
import type { DesignConversationRelocation, DesignDestinationProject } from './design-conversation-relocation.js';

type TrackedFile = DesignFile & { root: string; relativePath: string; revision?: string };
type MoveOptions = { sourceProject?: string | null; expectedRevision?: string; projectAtDestination?: DesignDestinationProject;
  relocateChats?: DesignConversationRelocation; allowPresetLibraries?: boolean };

export function deleteDesignWorkspaceDocument(root: string, relativePath: string, boundRoots: readonly string[],
  ownership: DesignResourceOwnership, signal: AbortSignal, expectedRevision?: string, relocateChats?: DesignConversationRelocation) {
  return withDesignSource(root, relativePath, boundRoots, undefined, signal, async (source, roots) => {
    // A damaged draft can still be removed. It cannot serve resources to another draft.
    const original = await readDependency(relativePath, () => readValidDesignDocument(source.target, relativePath));
    if (expectedRevision !== undefined && original?.revision !== expectedRevision) throw designChanged();
    const canonical = await realpath(source.target);
    if (original) await assertLibraryNotUsed(roots, boundRoots, canonical, original.document.documentId, ownership, signal);
    const remove = () => removeUnchangedFile({ ...source, root, relativePath, revision: original?.revision }, signal);
    if (relocateChats) await relocateChats({ source: canonical, target: null }, remove);
    else await remove();
    if (original) await ownership.forget(canonical, original.document.documentId).catch(() => undefined);
  }, { lockNestedRoots: true });
}

export function moveDesignWorkspaceDocument(sourceRoot: string, sourcePath: string, destinationRoot: string,
  boundRoots: readonly string[], ownership: DesignResourceOwnership, signal: AbortSignal, options: MoveOptions = {}) {
  return withDesignSource(sourceRoot, sourcePath, boundRoots, destinationRoot, signal, (source, roots) =>
    moveDocument(sourceRoot, sourcePath, destinationRoot, source, roots, boundRoots, ownership, signal, options), { lockNestedRoots: true });
}

async function moveDocument(sourceRoot: string, sourcePath: string, destinationRoot: string, source: DesignFile,
  roots: readonly string[], boundRoots: readonly string[], ownership: DesignResourceOwnership, signal: AbortSignal,
  { expectedRevision, projectAtDestination, relocateChats, sourceProject, allowPresetLibraries }: MoveOptions) {
  const name = path.basename(source.target);
  if (process.platform === 'win32' && !isValidWorkspaceEntryName(name)) {
    throw new FeatureOperationFailure({ code: 'INVALID_INPUT', message: 'The design requires a valid destination file name.', retryable: false });
  }
  const target = path.join(destinationRoot, name);
  if (await existingEntry(target)) throw destinationConflict(name);

  const original = await readDesignDocumentFile(source.target, sourcePath);
  if (expectedRevision !== undefined && original.revision !== expectedRevision) throw designChanged();
  const canonical = await realpath(source.target);
  const { documentId } = original.document;
  const resourceRoot = await designResourceDirectory(sourceRoot, canonical, original.document, roots, ownership, signal);
  await assertLibraryNotUsed(roots, boundRoots, canonical, documentId, ownership, signal);
  const createdFiles: (TrackedFile & { bindingId?: string })[] = [];
  const createdDirectories: DesignFile[] = [];
  const reusedLibraries = new Map<string, string>();

  async function assertReusableLibrary(relativePath: string, revision: string) {
    try {
      const { target } = await resolveDesignFile(destinationRoot, relativePath);
      const existing = await readDesignDocumentFile(target, relativePath);
      if (existing.revision === revision) {
        const root = await designResourceDirectory(destinationRoot, await realpath(target), existing.document, boundRoots, ownership,
          signal, { requireReadableDependencies: true });
        if (!path.relative(destinationRoot, root)) return;
      }
    } catch (error) {
      if (isFeatureOperationCancelled(error)) throw error;
    }
    signal.throwIfAborted();
    throw destinationConflict(relativePath, `The existing library "${relativePath}" conflicts with the destination resource directory.`);
  }

  const write: TransferWrite = async (relativePath, { content, revision, documentId }) => {
    signal.throwIfAborted();
    if (allowPresetLibraries === false && isDesignLibraryPresetDocumentId(documentId)) throw new FeatureOperationFailure({
      code: 'DESIGN_LIBRARY_PROJECT_REQUIRED', message: 'Design library sources require a project directory.', retryable: false,
    });
    const parent = await ensureParent(destinationRoot, relativePath, createdDirectories);
    const target = path.join(parent, path.posix.basename(relativePath));
    let stats: DesignFile['stats'];
    try {
      stats = await createWorkspaceFile(target, content);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      if (!revision) throw destinationConflict(relativePath);
      if (documentId) {
        await assertReusableLibrary(relativePath, revision);
        reusedLibraries.set(relativePath, revision);
      } else if (!await hasRevision(target, relativePath, revision)) throw destinationConflict(relativePath);
      return { ...await resolveDesignFile(destinationRoot, relativePath), root: destinationRoot, relativePath, revision };
    }
    // On Windows the final write timestamp can be published when the handle closes.
    const entry = await resolveExistingWorkspaceEntry(destinationRoot, relativePath);
    if (!sameEntry(entry, { target, stats })) throw designChanged();
    const created: (typeof createdFiles)[number] = { ...entry, root: destinationRoot, relativePath, revision: revision ?? original.revision };
    createdFiles.push(created);
    if (documentId && await ownership.remember(target, documentId, destinationRoot)) created.bindingId = documentId;
    return created;
  };
  try {
    const imports = await ownership.imports(canonical, documentId);
    if (path.relative(resourceRoot, destinationRoot)) await copyDependencies(resourceRoot, original.document, imports, write, signal);
    const copy = await write(name, { content: original.content, documentId });
    if (Object.keys(imports).length) await ownership.rememberImports(target, documentId, destinationRoot, imports);
    const association = await ownership.project(canonical, documentId);
    const linkedProject = association === undefined ? sourceProject : association;
    if (linkedProject !== undefined) await ownership.setProject(target, documentId, destinationRoot, linkedProject, await ownership.chatOrigin(canonical, documentId));
    // Later copies can introduce a second match for an existing library with no saved binding.
    for (const [relativePath, revision] of reusedLibraries) await assertReusableLibrary(relativePath, revision);
    const commit = () => removeUnchangedFile({ ...source, root: sourceRoot, relativePath: sourcePath, revision: original.revision }, signal, copy);
    if (relocateChats) await relocateChats({ source: canonical, target, documentId, projectAtDestination, linkedProject }, commit);
    else await commit();
  } catch (error) {
    // The copies are visible to external editors before the transfer commits.
    for (const file of createdFiles.reverse()) {
      const removed = await removeUnchangedFile(file)
        .then(() => true, (cause: unknown) => cause instanceof FeatureOperationFailure && cause.code === 'DESIGN_NOT_FOUND');
      if (removed && file.bindingId) await ownership.forget(file.target, file.bindingId).catch(() => undefined);
    }
    for (const directory of createdDirectories.reverse()) {
      const current = await resolveExistingWorkspaceEntry(destinationRoot, path.relative(destinationRoot, directory.target)).catch(() => undefined);
      if (current && sameEntry(current, directory) && current.stats.isDirectory()) await rmdir(current.target).catch(() => undefined);
    }
    throw error;
  }
  await ownership.forget(canonical, documentId).catch(() => undefined);
  return name;
}

function sameEntry(a: DesignFile, b: DesignFile) {
  return a.target === b.target && a.stats.ino === b.stats.ino && a.stats.dev === b.stats.dev;
}

export async function removeUnchangedFile(source: TrackedFile, signal?: AbortSignal, copy?: TrackedFile) {
  const files = copy ? [source, copy] : [source];
  await Promise.all(files.map(async (file) => {
    if (file.revision === undefined) return;
    const entry = await resolveDesignFile(file.root, file.relativePath);
    if (!sameEntry(entry, file) || !await hasRevision(entry.target, file.relativePath, file.revision)) throw designChanged();
  }));
  // Both paths can change outside the workspace locks. Check their identities again after hashing, just before unlink.
  await Promise.all(files.map(async (file) => {
    const current = await resolveDesignFile(file.root, file.relativePath);
    if (!sameEntry(current, file) || current.stats.size !== file.stats.size
      || current.stats.ctimeMs !== file.stats.ctimeMs || current.stats.mtimeMs !== file.stats.mtimeMs) throw designChanged();
  }));
  signal?.throwIfAborted();
  await unlink(source.target);
}

type TransferWrite = (relativePath: string, file: Readonly<{ content: string | Uint8Array; revision?: string; documentId?: string }>) => Promise<TrackedFile>;

async function copyDependencies(root: string, document: DesignDocument, imports: Record<string, string>, write: TransferWrite, signal: AbortSignal) {
  const imagePaths = new Set<string>();
  const sourcePaths = new Set<string>();
  const libraries = new Map<string, string>();
  const links = designLibraryFileLinks(document.libraries);
  async function copySource(relativePath: string, maxBytes: number) {
    signal.throwIfAborted();
    if (sourcePaths.has(relativePath)) return;
    const file = await readDependency(relativePath, () => readWorkspaceDesignSource(root, relativePath, maxBytes));
    await write(relativePath, file);
    sourcePaths.add(relativePath);
  }
  const copyAssets = async (document: DesignDocument) => {
    for (const relativePath of designDocumentImagePaths(document)) {
      signal.throwIfAborted();
      if (imagePaths.has(relativePath)) continue;
      const file = await readDependency(relativePath, async () => {
        const { target } = await resolveExistingWorkspaceEntry(root, relativePath);
        const file = await readWorkspaceFilePreview(target, relativePath);
        if (file.preview?.kind !== 'image') throw new Error('Expected an image file.');
        return { content: Buffer.from(file.preview.base64, 'base64'), revision: file.revision };
      });
      await write(relativePath, file);
      imagePaths.add(relativePath);
    }
    for (const node of Object.values(document.nodes)) {
      if (node.kind === 'script' && node.scriptPath) await copySource(node.scriptPath, maxDesignScriptBytes);
      for (const path of designLayerShaderPaths(node)) await copySource(path, maxDesignShaderBytes);
    }
  };
  await copyAssets(document);
  for (const [id, relativePath] of links) {
    signal.throwIfAborted();
    if (id === document.documentId || libraries.get(relativePath) === id) continue;
    const file = await readDependency(relativePath, async () => {
      const { target } = await resolveDesignFile(root, relativePath);
      const file = await readDesignDocumentFile(target, relativePath);
      if (file.document.documentId !== id) throw new Error('The library ID has changed.');
      return file;
    });
    await write(relativePath, { content: file.content, revision: file.revision, documentId: id });
    await copyAssets(file.document);
    libraries.set(relativePath, id);
    links.push(...designLibraryFileLinks(file.document.libraries));
  }
  for (const [path, revision] of Object.entries(imports)) {
    signal.throwIfAborted();
    if (imagePaths.has(path) || sourcePaths.has(path)) continue;
    const imported = await readVerifiedDesignImport(root, path, revision);
    if (imported) {
      const content = imported.preview?.kind === 'image' ? Buffer.from(imported.preview.base64, 'base64') : imported.content;
      await write(path, { revision, content });
    }
  }
}

async function assertLibraryNotUsed(roots: readonly string[], boundRoots: readonly string[], canonical: string, id: string,
  ownership: DesignResourceOwnership, signal: AbortSignal) {
  const seen = new Set<string>();
  for (const root of roots) {
    await walkWorkspaceFiles(root, async (target) => {
      if (!isDesignDocumentPath(target) || !path.relative(canonical, target)) return true;
      signal.throwIfAborted();
      const relativePath = path.relative(root, target).split(path.sep).join('/');
      const key = workspaceFilePathKey(root, relativePath);
      if (seen.has(key)) return true;
      seen.add(key);
      const other = await readDependency(relativePath, () => readValidDesignDocument(target, relativePath));
      const link = other?.document.libraries?.[id];
      if (!other || typeof link !== 'string' || findBundledDesignLibrary(link)) return true;
      const resourceRoot = await readDependency(relativePath, () =>
        designResourceDirectory(root, target, other.document, boundRoots, ownership, signal, { requireReadableDependencies: true }));
      const linked = await readDependency(relativePath, () => resolveDesignFile(resourceRoot, link)
        .then(({ target }) => realpath(target)).catch((error: unknown) => {
          if (error instanceof FeatureOperationFailure && error.code === 'DESIGN_NOT_FOUND') return undefined;
          throw error;
        }));
      if (!linked || path.relative(canonical, linked)) return true;
      throw new FeatureOperationFailure({
        code: 'DESIGN_LIBRARY_IN_USE', message: `The design is linked as a library by "${relativePath}".`, retryable: false,
      });
    }, { signal, onReadError: (directory) => { throw dependencyUnavailable(path.relative(root, directory) || '.'); } });
  }
}

async function readDependency<T>(relativePath: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isFeatureOperationCancelled(error)) throw error;
    throw dependencyUnavailable(relativePath);
  }
}

function dependencyUnavailable(relativePath: string) {
  return new FeatureOperationFailure({
    code: 'DESIGN_DEPENDENCY_UNAVAILABLE', message: `Could not verify the design dependency at "${relativePath}".`, retryable: false,
  });
}

async function ensureParent(root: string, relativePath: string, created: DesignFile[]) {
  let parent = root;
  for (const name of relativePath.split('/').slice(0, -1)) {
    const directory = path.join(parent, name);
    try {
      await mkdir(directory);
      created.push({ target: directory, stats: await lstat(directory) });
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    }
    parent = await resolveEntryParent(root, path.relative(root, directory));
  }
  return parent;
}

async function existingEntry(target: string) {
  return lstat(target).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  });
}

async function hasRevision(target: string, relativePath: string, revision: string) {
  if (!(await existingEntry(target))?.isFile()) return false;
  return (await readWorkspaceFilePreview(target, relativePath).catch(() => undefined))?.revision === revision;
}

function destinationConflict(relativePath: string, message = `An entry named "${relativePath}" already exists in the destination.`) {
  return new FeatureOperationFailure({
    code: WORKSPACE_ENTRY_EXISTS_ERROR_CODE, message, retryable: false,
  });
}
