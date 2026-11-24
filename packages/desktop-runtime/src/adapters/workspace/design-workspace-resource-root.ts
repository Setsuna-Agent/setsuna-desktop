import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { workspaceFilePathKey, workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { designDocumentAssetPaths, designLibraryFileLinks, isDesignDocumentPath, isDesignLibraryPresetDocumentId,
  type DesignDirectory, type DesignWorkspace, type DesignDocument, type DesignDocumentRef } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { RuntimeUseCaseError } from '../../runtime/use-cases/errors.js';
import { isNodeError } from '../../shared/node-errors.js';
import { isPathWithin } from '../search/workspace-search-policy.js';
import { withFileStateUpdate, withFileStateUpdates } from '../store/file-state-coordinator.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';
import { createDesignCatalogFileReader } from './design-workspace-catalog-file.js';
import { readDesignDocumentFile, readValidDesignDocument, resolveDesignFile, withDesignSource } from './design-workspace-document-file.js';
import { resolveExistingWorkspaceEntry, type WorkspaceEntryRelocation } from './workspace-entry-mutations.js';
import { walkWorkspaceFiles } from './workspace-file-walk.js';
import type { DesignConversationRelocation, DesignDestinationProject } from './design-conversation-relocation.js';

export type DesignResourceOwnership = ReturnType<typeof createDesignResourceOwnership>;
type DraftLocation = Readonly<{ file: string; id: string }>;
type DraftBinding = Readonly<DraftLocation & { root: string; threadId?: string; projectId?: string | null; imports?: Record<string, string> }>;
const ownershipDirectory = 'design-resource-roots';
const associationReadBatchSize = 4;

export function createDesignResourceOwnership(dataDir: string) {
  const directory = path.join(dataDir, ownershipDirectory);
  const startAssociationScan = createDesignCatalogFileReader('validated');
  // Workspace bindings are local. Scope each record to a file and its document ID so duplicate or replaced drafts do not inherit it.
  function recordPath(target: string, documentId: string) {
    const key = workspaceFilePathKey(path.dirname(target), path.basename(target));
    const name = createHash('sha256').update(JSON.stringify([key, documentId])).digest('hex');
    return path.join(directory, `${name}.json`);
  }

  async function readRecord(file: string): Promise<DraftBinding | string | undefined> {
    const record = await readJsonFile<unknown>(file, undefined);
    if (record === undefined || (typeof record === 'string' && path.isAbsolute(record))) return record;
    if (isDraftBinding(record) && recordPath(record.file, record.id) === file) return record;
    throw designResourceRootUnavailable();
  }

  async function storeBinding(file: string, binding: DraftBinding) {
    const existing = await readRecord(file);
    const root = bindingRoot(existing);
    if (root !== undefined && path.relative(root, binding.root)) throw designResourceRootUnavailable();
    if (typeof existing !== 'object') await writeJsonFile(file, binding, { mode: 0o600 });
    return existing === undefined;
  }

  function remember(target: string, id: string, root: string) {
    const file = recordPath(target, id);
    return withFileStateUpdate(file, () => storeBinding(file, { file: target, id, root }));
  }

  async function records() {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    });
    return entries.filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name)).map((entry) => path.join(directory, entry.name));
  }

  function availableRecord(file: string) {
    return readRecord(file).catch((error: unknown) => {
      if (isUnreadable(error) || isResourceRootUnavailable(error) || (error instanceof Error && error.cause instanceof SyntaxError)) return undefined;
      throw error;
    });
  }

  async function findAtEntry(source: string, type: 'file' | 'directory', includeStale = false) {
    const drafts: DraftLocation[] = [];
    const legacy = new Set<string>();
    for (const file of await records()) {
      const record = await availableRecord(file);
      if (typeof record === 'string') {
        if (isPathWithin(record, source) || isPathWithin(source, record)) legacy.add(file);
      } else if (record && isPathWithin(source, record.file)) {
        if (includeStale) { drafts.push(record); continue; }
        const id = await readDraftId(record.file).catch((error: unknown) => {
          // An existing binding still identifies a draft while its directory is unreadable.
          if (isUnreadable(error)) return record.id;
          throw error;
        });
        if (id === record.id) drafts.push(record);
      }
    }
    if (legacy.size > 0) {
      // Older records only contain the root. Match their hashes in the affected subtree until they can be upgraded.
      const matchLegacy = async (file: string) => {
        if (!isDesignDocumentPath(file)) return true;
        const id = await readDraftId(file).catch((error: unknown) => {
          if (isUnreadable(error)) return undefined;
          throw error;
        });
        if (id !== undefined && legacy.delete(recordPath(file, id))) drafts.push({ file, id });
        return legacy.size > 0;
      };
      if (type === 'file') await matchLegacy(source);
      else await walkWorkspaceFiles(source, matchLegacy);
    }
    return drafts;
  }

  return {
    async read(target: string, id: string) {
      const record = await readRecord(recordPath(target, id));
      if (typeof record === 'string') await remember(target, id, record).catch(() => undefined);
      return bindingRoot(record);
    },
    async project(target: string, id: string) {
      const record = await readRecord(recordPath(target, id));
      return typeof record === 'object' ? record.projectId : undefined;
    },
    async chatOrigin(file: string, id: string) {
      const record = await readRecord(recordPath(file, id));
      return typeof record === 'object' ? record.threadId : undefined;
    },
    async imports(file: string, id: string) {
      const record = await readRecord(recordPath(file, id));
      return typeof record === 'object' ? record.imports ?? {} : {};
    },
    rememberImports(file: string, id: string, root: string, imports: Record<string, string>) {
      const location = recordPath(file, id);
      return withFileStateUpdate(location, async () => {
        const record = await readRecord(location);
        if (bindingRoot(record) !== root) throw designResourceRootUnavailable();
        const binding = typeof record === 'object' ? record : { file, id, root };
        await writeJsonFile(location, { ...binding, imports: { ...binding.imports, ...imports } }, { mode: 0o600 });
      });
    },
    setProject(file: string, id: string, root: string, projectId: string | null, threadId?: string) {
      const location = recordPath(file, id);
      return withFileStateUpdate(location, async () => {
        const previous = await readRecord(location);
        const binding = { ...(typeof previous === 'object' ? previous : {}), file, id, root, projectId };
        await writeJsonFile(location, threadId ? { ...binding, threadId } : binding, { mode: 0o600 });
      });
    },
    async associations(signal: AbortSignal, projectId?: string) {
      const result: (DraftBinding & { projectId: string | null })[] = [];
      const scan = startAssociationScan(signal);
      async function readAssociation(file: string) {
        const record = await availableRecord(file);
        if (typeof record !== 'object' || record.projectId === undefined || (projectId !== undefined && record.projectId !== projectId)) return;
        signal.throwIfAborted();
        // An offline or unreadable external draft must not hide other drafts in the catalog.
        const entry = await scan.read(record.file).catch(() => undefined);
        if (entry?.documentId === record.id) return { ...record, projectId: record.projectId };
      }
      const paths = await records();
      // Overlap disk reads while bounding the number of full design documents being validated.
      for (let start = 0; start < paths.length; start += associationReadBatchSize) {
        signal.throwIfAborted();
        const batch = await Promise.all(paths.slice(start, start + associationReadBatchSize).map(readAssociation));
        for (const binding of batch) if (binding) result.push(binding);
      }
      signal.throwIfAborted();
      scan.finish();
      return result;
    },
    remember,
    forget: (target: string, id: string) => rm(recordPath(target, id), { force: true }),
    findAtEntry,
    async relocate(source: string, target: string, type: 'file' | 'directory', drafts: readonly DraftLocation[], relocateEntry: () => Promise<void>) {
      const incoming = drafts.map(({ file, id }) => {
        const destination = path.join(target, path.relative(source, file));
        return { previous: recordPath(file, id), next: recordPath(destination, id), destination, id };
      });
      const changes = incoming.filter(({ previous, next }) => previous !== next);
      const covered = new Set(incoming.map(({ next }) => next));
      // An unbound draft can arrive at the name of a directory removed outside the app.
      // Retire all unmatched destination bindings, even when the source subtree has none.
      const retired = (await findAtEntry(target, type, true)).map(({ file, id }) => recordPath(file, id)).filter((file) => !covered.has(file));
      return withFileStateUpdates([...retired, ...changes.flatMap(({ previous, next }) => [previous, next])], async () => {
        const staged = new Map<string, DraftBinding | string | undefined>();
        try {
          for (const file of retired) {
            staged.set(file, await readRecord(file));
            await rm(file, { force: true });
          }
          for (const { previous, next, destination, id } of changes) {
            const record = await readRecord(previous);
            const root = bindingRoot(record);
            if (root !== undefined && !isPathWithin(root, destination)) {
              throw new RuntimeUseCaseError('conflict', 'Use “Change save location” in Design to move a draft outside its original resource directory.');
            }
            // A previously deleted copy with the same ID may have left a binding at the destination.
            // Preserve it only for rollback if the filesystem refuses the rename.
            const old = await readRecord(next);
            if (old === undefined && root === undefined) continue;
            staged.set(next, old);
            if (root === undefined) await rm(next, { force: true });
            else await writeJsonFile(next, { ...(typeof record === 'object' ? record : {}), file: destination, id, root }, { mode: 0o600 });
          }
          await relocateEntry();
        } catch (error) {
          for (const [file, old] of staged) {
            if (old === undefined) await rm(file, { force: true });
            else await writeJsonFile(file, old, { mode: 0o600 });
          }
          throw error;
        }
        for (const { previous } of changes) await rm(previous, { force: true });
      });
    },
  };
}

export function createDesignWorkspaceEntryRelocation(dataDir: string, relocateChats?: DesignConversationRelocation,
  projectAtDestination?: DesignDestinationProject): WorkspaceEntryRelocation {
  const ownership = createDesignResourceOwnership(dataDir);
  return async (source, target, type, relocateEntry) => {
    const canonical = await realpath(source);
    // An explicit association follows a file-tree rename, even outside the linked project's roots.
    const destinationProject: DesignDestinationProject | undefined = projectAtDestination && (async (owner, next, file, id) => {
      const linked = await ownership.project(file, id);
      return linked === undefined ? projectAtDestination(owner, next, file, id) : linked;
    });
    const move = (id?: string) => relocateChats ? relocateChats({ source: canonical, target, documentId: id,
      projectAtDestination: destinationProject }, relocateEntry) : relocateEntry();
    if (target === null) {
      const drafts = await ownership.findAtEntry(canonical, type, true);
      try {
        await move();
      } catch (error) {
        // A recursive deletion may fail after removing only some of the drafts.
        for (const { file, id } of drafts) {
          const missing = await lstat(file).then(() => false, (cause) => isNodeError(cause) && (cause.code === 'ENOENT' || cause.code === 'ENOTDIR'));
          if (missing) await ownership.forget(file, id);
        }
        throw error;
      }
      for (const { file, id } of drafts) await ownership.forget(file, id);
      return;
    }
    if (type === 'file' && (isDesignDocumentPath(source) || isDesignDocumentPath(target))) {
      const id = await readDraftId(canonical);
      return ownership.relocate(canonical, target, type, id === undefined ? [] : [{ file: canonical, id }], () => move(id));
    }
    const drafts = await ownership.findAtEntry(canonical, type);
    return ownership.relocate(canonical, target, type, drafts, () => move());
  };
}

function bindingRoot(record: DraftBinding | string | undefined) {
  return typeof record === 'string' ? record : record?.root;
}

function isDraftBinding(record: unknown): record is DraftBinding {
  return !!record && typeof record === 'object' && 'file' in record && typeof record.file === 'string' && path.isAbsolute(record.file)
    && 'id' in record && typeof record.id === 'string' && 'root' in record && typeof record.root === 'string' && path.isAbsolute(record.root);
}

function isResourceRootUnavailable(error: unknown) {
  return error instanceof FeatureOperationFailure && error.code === 'DESIGN_RESOURCE_ROOT_UNAVAILABLE';
}

function isUnreadable(error: unknown) {
  return isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM');
}

export async function readDraftId(file: string) {
  try {
    // A replaced directory or symlink must not make a stale binding apply to another file.
    if (path.relative(file, await realpath(file)) || !(await lstat(file)).isFile()) return;
    return (await readValidDesignDocument(file, path.basename(file)))?.document.documentId;
  } catch (error) {
    if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP')) return;
    throw error;
  }
}

export function resolveDesignResourceRoot(ref: DesignDocumentRef, root: string, projects: readonly WorkspaceProject[],
  ownership: DesignResourceOwnership, signal: AbortSignal, directories: DesignDirectory[] = []) {
  const scopes: { directory: string; scope: DesignWorkspace }[] = projects.flatMap((project) => workspaceProjectRoots(project).map((candidate) => ({
    directory: candidate.path, scope: { projectId: project.id, rootId: candidate.id },
  })));
  scopes.push(...directories.map((item) => ({ directory: item.path, scope: { storageId: item.id } })));
  return withDesignSource(root, ref.path, scopes.map(({ directory }) => directory), undefined, signal, async (file, roots) => {
    const target = await realpath(file.target);
    const { document } = await readDesignDocumentFile(target, ref.path);
    if (isDesignLibraryPresetDocumentId(document.documentId)) throw new FeatureOperationFailure({
      code: 'INVALID_INPUT', message: 'Open built-in design libraries from the design resource library.', retryable: false,
    });
    const directory = await designResourceDirectory(root, target, document, roots, ownership, signal);
    const relativePath = path.relative(directory, target).split(path.sep).join('/');
    if (!path.relative(root, directory)) return { ...ref, path: relativePath };
    const scope = scopes.find((scope) => !path.relative(scope.directory, directory));
    if (!scope) throw designResourceRootUnavailable();
    return { ...scope.scope, path: relativePath };
  });
}

export async function designResourceDirectory(root: string, target: string, document: DesignDocument, roots: readonly string[],
  ownership: DesignResourceOwnership, signal: AbortSignal, options?: Readonly<{ requireReadableDependencies: boolean }>,
) {
  signal.throwIfAborted();
  const candidates = [...new Set([root, ...roots])].filter((candidate) => isPathWithin(candidate, target));
  const saved = await ownership.read(target, document.documentId);
  if (saved !== undefined) {
    const bound = candidates.find((candidate) => !path.relative(candidate, saved));
    if (!bound) throw designResourceRootUnavailable();
    return bound;
  }
  if (candidates.length < 2) return root;

  return inferResourceDirectory(root, document, candidates, signal, options?.requireReadableDependencies);
}

export async function bindDesignResourcesForEdit(root: string, target: string, previous: DesignDocument, next: DesignDocument,
  roots: readonly string[], ownership: DesignResourceOwnership, signal: AbortSignal) {
  if (await ownership.read(target, previous.documentId) !== undefined) return false;
  if (!designLibraryFileLinks(next.libraries).length && !designDocumentAssetPaths(next).size) return false;
  // A newly referenced path may exist in several roots. Infer ownership from the draft as it was opened.
  const directory = roots.length === 1 ? root : await inferResourceDirectory(root, previous, roots, signal);
  return ownership.remember(target, previous.documentId, directory);
}

async function inferResourceDirectory(root: string, document: DesignDocument, candidates: readonly string[], signal: AbortSignal,
  requireReadableDependencies = false) {
  const assets = designDocumentAssetPaths(document);
  const libraries = designLibraryFileLinks(document.libraries);
  const onDependencyError = requireReadableDependencies ? ignoreMissingDependency : () => undefined;
  let match: string | undefined;
  for (const candidate of candidates) {
    if (!await hasDesignDependencies(candidate, assets, libraries, signal, onDependencyError)) continue;
    // A partial match can be the original root with a missing asset, so it also makes ownership ambiguous.
    if (match && path.relative(match, candidate)) throw new FeatureOperationFailure({
      code: 'DESIGN_RESOURCE_ROOT_AMBIGUOUS', message: 'More than one workspace directory contains this draft’s resources. Its original resource directory cannot be determined.', retryable: false,
    });
    match = candidate;
  }
  signal.throwIfAborted();
  return match ?? root;
}

async function hasDesignDependencies(root: string, assets: ReadonlySet<string>, libraries: readonly [string, string][], signal: AbortSignal,
  onError: (error: unknown) => undefined,
) {
  for (const asset of assets) {
    signal.throwIfAborted();
    const entry = await resolveExistingWorkspaceEntry(root, asset).catch(onError);
    if (entry?.stats.isFile()) return true;
  }
  for (const [id, link] of libraries) {
    signal.throwIfAborted();
    const file = await resolveDesignFile(root, link).then(({ target }) => readValidDesignDocument(target, link)).catch(onError);
    if (file?.document.documentId === id) return true;
  }
  return false;
}

function ignoreMissingDependency(error: unknown): undefined {
  if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'DESIGN_NOT_FOUND')) return undefined;
  throw error;
}

export function designResourceRootUnavailable() {
  return new FeatureOperationFailure({
    code: 'DESIGN_RESOURCE_ROOT_UNAVAILABLE', message: 'Open this draft from its original workspace directory to access its resources.', retryable: false,
  });
}
