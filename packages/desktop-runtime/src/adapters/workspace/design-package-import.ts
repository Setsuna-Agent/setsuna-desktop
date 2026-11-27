import { mkdir, mkdtemp, open, readFile, rm, rmdir } from 'node:fs/promises';
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
  const staging = await mkdtemp(path.join(root, workspaceTemporaryDirectoryPrefix));
  try {
    const restored = await unpackPackage(source.target, staging, signal);
    return await withFileStateUpdate(root, () => commitPackage(root, staging, input.destination, restored, host, signal));
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
}

async function unpackPackage(source: string, staging: string, signal: AbortSignal) {
  return withDesignPackageArchive(source, signal, async (archive) => {
    const manifestPath = path.join(staging, designPackageManifestFile);
    await archive.extract(designPackageManifestFile, manifestPath, maxDesignPackageManifestBytes);
    const manifest = JSON.parse(await readFile(manifestPath, { encoding: 'utf8', signal })) as Partial<DesignPackageManifest> | null;
    const archiveEntry = manifest?.entry;
    if (manifest?.formatVersion !== 1 || manifest.resourceRoot !== designPackageResourceRoot || typeof archiveEntry !== 'string'
      || !archiveEntry.startsWith(designPackageContentPrefix) || !isDesignDocumentPath(archiveEntry)) throw invalidDesignPackage();
    const entry = archiveEntry.slice(designPackageContentPrefix.length);
    const dependencies = designPackageDependencies(entry);
    const documents = new Map<string, string>();
    // Extract only the dependency graph, keeping the original bytes and paths intact.
    for (const dependency of dependencies.files.values()) {
      const archivePath = designPackageContentPrefix + dependency.path;
      const target = path.join(staging, archivePath);
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

async function commitPackage(root: string, staging: string, { name, linkedProjectId }: ImportDesignPackageInput['destination'],
  { entry, documents }: Awaited<ReturnType<typeof unpackPackage>>, { storage, ownership }: ImportHost, signal: AbortSignal) {
  const knownRoots = new Set((await storage.list()).map(({ path }) => workspaceFilePathKey(path, '.')));
  const container = await reserveImportDirectory(root, name, knownRoots, signal);
  const resourceRoot = path.join(container, designPackageResourceRoot);
  const bindings = new Map<string, string>();
  let installed = false;
  try {
    for (const [relative, id] of documents) {
      signal.throwIfAborted();
      const target = path.join(resourceRoot, relative);
      if (relative === entry) await ownership.setProject(target, id, resourceRoot, linkedProjectId ?? null);
      else await ownership.remember(target, id, resourceRoot);
      bindings.set(target, id);
    }
    // Expose the whole resource tree at once, after validation and root binding.
    await renameWithRetry(path.join(staging, designPackageResourceRoot), resourceRoot, { beforeRename: async () => signal.throwIfAborted() });
    installed = true;
    const directory = await storage.remember(resourceRoot);
    return { storageId: directory.id, path: entry };
  } catch (error) {
    if (installed) await rm(resourceRoot, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
    for (const [target, id] of bindings) await ownership.forget(target, id).catch(() => undefined);
    await rmdir(container).catch(() => undefined);
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
      return folder;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    }
  }
}
