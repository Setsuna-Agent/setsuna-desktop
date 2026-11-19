import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { workspaceFilePathKey, workspaceProjectRoots, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { designDocumentImagePaths, designLayerShaderPaths, isDesignDocumentPath,
  type DesignDocument, type DesignDocumentRef } from '@setsuna-desktop/feature-design/contracts';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { RuntimeUseCaseError } from '../../runtime/use-cases/errors.js';
import { isNodeError } from '../../shared/node-errors.js';
import { isPathWithin } from '../search/workspace-search-policy.js';
import { withFileStateUpdate, withFileStateUpdates } from '../store/file-state-coordinator.js';
import { readJsonFile, writeJsonFile } from '../store/json-file.js';
import { readDesignDocumentFile, readValidDesignDocument, resolveDesignFile, withDesignSource } from './design-workspace-document-file.js';
import { resolveExistingWorkspaceEntry, type WorkspaceEntryRelocation } from './workspace-entry-mutations.js';
import { walkWorkspaceFiles } from './workspace-file-walk.js';

export type DesignResourceOwnership = ReturnType<typeof createDesignResourceOwnership>;
type DraftLocation = Readonly<{ file: string; id: string }>;
type DraftBinding = Readonly<DraftLocation & { root: string }>;
const ownershipDirectory = 'design-resource-roots';

export function createDesignResourceOwnership(dataDir: string) {
  const directory = path.join(dataDir, ownershipDirectory);
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

  async function findInDirectory(source: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    });
    const drafts: DraftLocation[] = [];
    const legacy = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
      const file = path.join(directory, entry.name);
      const record = await readRecord(file).catch((error: unknown) => {
        if (isUnreadable(error) || isResourceRootUnavailable(error) || (error instanceof Error && error.cause instanceof SyntaxError)) return undefined;
        throw error;
      });
      if (typeof record === 'string') {
        if (isPathWithin(record, source) || isPathWithin(source, record)) legacy.add(file);
      } else if (record && isPathWithin(source, record.file)) {
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
      await walkWorkspaceFiles(source, async (file) => {
        if (!isDesignDocumentPath(file)) return true;
        const id = await readDraftId(file).catch((error: unknown) => {
          if (isUnreadable(error)) return undefined;
          throw error;
        });
        if (id !== undefined && legacy.delete(recordPath(file, id))) drafts.push({ file, id });
        return legacy.size > 0;
      });
    }
    return drafts;
  }

  return {
    async read(target: string, id: string) {
      const record = await readRecord(recordPath(target, id));
      if (typeof record === 'string') await remember(target, id, record).catch(() => undefined);
      return bindingRoot(record);
    },
    remember,
    forget: (target: string, id: string) => rm(recordPath(target, id), { force: true }),
    findInDirectory,
    relocate(source: string, target: string, drafts: readonly DraftLocation[], relocateEntry: () => Promise<void>) {
      const changes = drafts.map(({ file, id }) => {
        const destination = path.join(target, path.relative(source, file));
        return { previous: recordPath(file, id), next: recordPath(destination, id), destination, id };
      }).filter(({ previous, next }) => previous !== next);
      return withFileStateUpdates(changes.flatMap(({ previous, next }) => [previous, next]), async () => {
        const bindings: { previous: string; next: string; binding: DraftBinding }[] = [];
        for (const { previous, next, destination, id } of changes) {
          const root = bindingRoot(await readRecord(previous));
          if (root === undefined) continue;
          // The file tree preserves ownership. A transfer in Design can also copy its dependencies.
          if (!isPathWithin(root, destination)) {
            throw new RuntimeUseCaseError('conflict', 'Use “Move to another project” in Design to move a draft outside its original resource directory.');
          }
          bindings.push({ previous, next, binding: { file: destination, id, root } });
        }
        const added: string[] = [];
        try {
          // Prepare every new binding before the filesystem relocation is visible.
          for (const { next, binding } of bindings) {
            if (await storeBinding(next, binding)) added.push(next);
          }
          await relocateEntry();
        } catch (error) {
          for (const file of added) await rm(file, { force: true }).catch(() => undefined);
          throw error;
        }
        for (const { previous } of bindings) await rm(previous, { force: true }).catch(() => undefined);
      });
    },
  };
}

export function createDesignWorkspaceEntryRelocation(dataDir: string): WorkspaceEntryRelocation {
  const ownership = createDesignResourceOwnership(dataDir);
  return async (source, target, type, relocateEntry) => {
    if (type === 'file' && !isDesignDocumentPath(source) && !isDesignDocumentPath(target)) return relocateEntry();
    const canonical = await realpath(source);
    if (type === 'file') {
      const id = await readDraftId(canonical);
      return id === undefined ? relocateEntry() : ownership.relocate(canonical, target, [{ file: canonical, id }], relocateEntry);
    }
    const drafts = await ownership.findInDirectory(canonical);
    return ownership.relocate(canonical, target, drafts, relocateEntry);
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

async function readDraftId(file: string) {
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
  ownership: DesignResourceOwnership, signal: AbortSignal) {
  const scopes = projects.flatMap((project) => workspaceProjectRoots(project).map((candidate) => ({
    directory: candidate.path, projectId: project.id, rootId: candidate.id,
  })));
  return withDesignSource(root, ref.path, scopes.map(({ directory }) => directory), undefined, signal, async (file, roots) => {
    const target = await realpath(file.target);
    const { document } = await readDesignDocumentFile(target, ref.path);
    const directory = await designResourceDirectory(root, target, document, roots, ownership, signal);
    const relativePath = path.relative(directory, target).split(path.sep).join('/');
    if (!path.relative(root, directory)) return { ...ref, path: relativePath };
    const scope = scopes.find((scope) => !path.relative(scope.directory, directory));
    if (!scope) throw designResourceRootUnavailable();
    return { projectId: scope.projectId, rootId: scope.rootId, path: relativePath };
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

function designAssetPaths(document: DesignDocument) {
  const paths = new Set(designDocumentImagePaths(document));
  for (const node of Object.values(document.nodes)) {
    if (node.kind === 'script' && node.scriptPath) paths.add(node.scriptPath);
    for (const shader of designLayerShaderPaths(node)) paths.add(shader);
  }
  return paths;
}

export async function bindDesignResourcesForEdit(root: string, target: string, previous: DesignDocument, next: DesignDocument,
  roots: readonly string[], ownership: DesignResourceOwnership, signal: AbortSignal) {
  if (await ownership.read(target, previous.documentId) !== undefined) return false;
  if (!Object.keys(next.libraries ?? {}).length && !designAssetPaths(next).size) return false;
  // A newly referenced path may exist in several roots. Infer ownership from the draft as it was opened.
  const directory = roots.length === 1 ? root : await inferResourceDirectory(root, previous, roots, signal);
  return ownership.remember(target, previous.documentId, directory);
}

async function inferResourceDirectory(root: string, document: DesignDocument, candidates: readonly string[], signal: AbortSignal,
  requireReadableDependencies = false) {
  const assets = designAssetPaths(document);
  const libraries = Object.entries(document.libraries ?? {});
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
