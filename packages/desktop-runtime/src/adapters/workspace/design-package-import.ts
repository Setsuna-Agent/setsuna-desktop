import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { workspaceFilePathKey, workspaceTemporaryDirectoryPrefix } from '@setsuna-desktop/contracts';
import { designPackageContentPrefix, designPackageImportStagingPrefix, designPackageManifestFile, designPackageResourceRoot,
  designPackageStagingFile, isDesignDocumentPath, isDesignLibraryPresetDocumentId, maxDesignPackageArchiveBytes,
  maxDesignPackageManifestBytes, type DesignDocumentRef, type DesignPackageManifest, type ImportDesignPackageInput } from '@setsuna-desktop/feature-design/contracts';
import { isNodeError } from '../../shared/node-errors.js';
import { withFileStateUpdate } from '../store/file-state-coordinator.js';
import { renameWithRetry } from '../store/json-file.js';
import { invalidDesignPackage, withDesignPackageArchive } from './design-package-archive.js';
import { designPackageDependencies, designPackageFileLimits, designPackageTooLarge,
  parseDesignPackageText, readDesignPackageImageType } from './design-package-dependencies.js';
import type { designStorageDirectories } from './design-storage-directories.js';
import type { DesignResourceOwnership } from './design-workspace-resource-root.js';
import { resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';

type ImportHost = Readonly<{
  storage: ReturnType<typeof designStorageDirectories>;
  ownership: DesignResourceOwnership;
}>;

export async function installDesignPackage(dataDirectory: string, root: string, input: ImportDesignPackageInput, host: ImportHost,
  signal: AbortSignal): Promise<DesignDocumentRef> {
  const source = await resolveExistingWorkspaceEntry(dataDirectory, `${designPackageImportStagingPrefix}${input.ticket}/${designPackageStagingFile}`);
  if (!source.stats.isFile() || !source.stats.size) throw invalidDesignPackage();
  if (source.stats.size > maxDesignPackageArchiveBytes) throw designPackageTooLarge();
  signal.throwIfAborted();
  const staging = await importDirectory(await mkdtemp(path.join(root, workspaceTemporaryDirectoryPrefix)));
  try {
    const restored = await unpackPackage(source.target, staging.path, signal);
    return await withFileStateUpdate(root, () => commitPackage(root, staging, input.destination, restored, host, signal));
  } finally {
    await assertImportDirectory(staging).then(() => rm(staging.path, { recursive: true, force: true, maxRetries: 5 })).catch(() => undefined);
  }
}

async function unpackPackage(source: string, staging: string, signal: AbortSignal) {
  return withDesignPackageArchive(source, signal, async (archive) => {
    const manifestPath = path.join(staging, designPackageManifestFile);
    await archive.extract(designPackageManifestFile, manifestPath, maxDesignPackageManifestBytes);
    const manifest = JSON.parse(await readFile(manifestPath, { encoding: 'utf8', signal })) as Partial<DesignPackageManifest> | null;
    // Only the content tree is moved into the project.
    await unlink(manifestPath);
    const archiveEntry = manifest?.entry;
    if (manifest?.formatVersion !== 1 || manifest.resourceRoot !== designPackageResourceRoot || typeof archiveEntry !== 'string'
      || !archiveEntry.startsWith(designPackageContentPrefix) || !isDesignDocumentPath(archiveEntry)) throw invalidDesignPackage();
    const entry = archiveEntry.slice(designPackageContentPrefix.length);
    const dependencies = designPackageDependencies(entry);
    const documents = new Map<string, string>();
    // Extract only the dependency graph, keeping the original bytes and paths intact.
    for (const dependency of dependencies.files.values()) {
      const archivePath = designPackageContentPrefix + dependency.path;
      const target = path.join(staging, dependency.path);
      await mkdir(path.dirname(target), { recursive: true });
      const size = await archive.extract(archivePath, target, designPackageFileLimits[dependency.kind]);
      if (dependency.kind === 'image') {
        const file = await open(target, 'r');
        try { await readDesignPackageImageType(file, size); } finally { await file.close(); }
      } else {
        const document = parseDesignPackageText(dependency, await readFile(target, { signal }));
        if (document) {
          if (dependency.path === entry && isDesignLibraryPresetDocumentId(document.documentId)) throw invalidDesignPackage();
          documents.set(dependency.path, document.documentId);
          dependencies.collect(document);
        }
      }
    }
    if (archive.entryCount !== dependencies.files.size + 1) throw invalidDesignPackage('The design package contains unrelated files.');
    return { entry, documents };
  });
}

async function commitPackage(root: string, staging: ImportDirectory, { name, linkedProjectId }: ImportDesignPackageInput['destination'],
  { entry, documents }: Awaited<ReturnType<typeof unpackPackage>>, { storage, ownership }: ImportHost, signal: AbortSignal) {
  const knownRoots = new Set((await storage.list()).map(({ path }) => workspaceFilePathKey(path, '.')));
  await assertImportDirectory(staging);
  const container = await reserveImportDirectory(root, name, knownRoots, signal);
  const resourceRoot = path.join(container.path, designPackageResourceRoot);
  const bindings = new Map<string, string>();
  try {
    for (const [relative, id] of documents) {
      signal.throwIfAborted();
      const target = path.join(resourceRoot, relative);
      if (relative === entry) await ownership.setProject(target, id, resourceRoot, linkedProjectId ?? null);
      else await ownership.remember(target, id, resourceRoot);
      bindings.set(target, id);
    }
    async function checkDestination() {
      // Even an empty directory added during registration belongs to its creator.
      const occupied = await lstat(resourceRoot).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (occupied) throw new Error('The design package destination is already occupied.');
      await Promise.all([assertImportDirectory(container), assertImportDirectory(staging)]);
      signal.throwIfAborted();
    }
    await checkDestination();
    const directory = await storage.withNewDirectoryGrant(resourceRoot,
      () => renameWithRetry(staging.path, resourceRoot, { beforeRename: checkDestination }));
    return { storageId: directory.id, path: entry };
  } catch (error) {
    for (const [target, id] of bindings) await ownership.forget(target, id).catch(() => undefined);
    await assertImportDirectory(container).then(() => rmdir(container.path)).catch(() => undefined);
    throw error;
  }
}

async function reserveImportDirectory(root: string, name: string, knownRoots: ReadonlySet<string>, signal: AbortSignal) {
  for (let ordinal = 1; ; ordinal += 1) {
    signal.throwIfAborted();
    const folder = path.join(root, ordinal === 1 ? name : `${name} ${ordinal}`);
    if (knownRoots.has(workspaceFilePathKey(folder, designPackageResourceRoot))) continue;
    try {
      await mkdir(folder, { mode: 0o700 });
      return importDirectory(folder);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    }
  }
}

type ImportDirectory = Awaited<ReturnType<typeof importDirectory>>;

async function importDirectory(directory: string) {
  const [canonical, stats] = await Promise.all([realpath(directory), lstat(directory, { bigint: true })]);
  if (path.relative(directory, canonical) || !stats.isDirectory()) throw new Error('The design package directory has changed.');
  return { path: directory, dev: stats.dev, ino: stats.ino, birthtime: stats.birthtimeNs };
}

async function assertImportDirectory(expected: ImportDirectory) {
  const current = await importDirectory(expected.path);
  if (current.dev !== expected.dev || current.ino !== expected.ino || current.birthtime !== expected.birthtime) {
    throw new Error('The design package directory has changed.');
  }
}
