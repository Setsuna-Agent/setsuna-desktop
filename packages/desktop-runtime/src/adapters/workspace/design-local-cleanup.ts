import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isValidWorkspaceEntryName, workspaceFilePathKey } from '@setsuna-desktop/contracts';
import { designDocumentAssetPaths, designImageFileExtensions, designLibraryFileLinks, isDesignDocumentPath, isDesignLibraryPresetDocumentId,
  type DesignCleanupSelection, type LocalDesignFile, type LocalDesignInventory } from '@setsuna-desktop/feature-design/contracts';
import { isNodeError } from '../../shared/node-errors.js';
import { isPathWithin } from '../search/workspace-search-policy.js';
import { withFileStateUpdates } from '../store/file-state-coordinator.js';
import { readDesignDocumentFile } from './design-workspace-document-file.js';
import { removeUnchangedFile } from './design-workspace-document-mutations.js';
import { designResourceDirectory, type DesignResourceOwnership } from './design-workspace-resource-root.js';
import { resolveExistingWorkspaceEntry } from './workspace-entry-mutations.js';
import { walkWorkspaceFiles } from './workspace-file-walk.js';

const assetExtensions = new Set<string>([...designImageFileExtensions, 'js', 'glsl']);
const pathKey = (file: string) => path.normalize(file).normalize('NFC').toLowerCase();

type ScannedDraft = { file: Extract<LocalDesignFile, { kind: 'document' }>; id: string; libraries: [string, string][] };

async function resolveLibraryLinks(root: string, libraries?: Readonly<Record<string, string>>) {
  const links: [string, string][] = [];
  for (const [id, link] of designLibraryFileLinks(libraries)) {
    try {
      const target = await realpath(path.join(root, link));
      links.push([id, workspaceFilePathKey(target, '.')]);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    }
  }
  return links;
}

async function inventory(local: string, roots: readonly string[], ownership: DesignResourceOwnership, signal: AbortSignal): Promise<LocalDesignInventory> {
  // A project enclosing the local store can reference its assets. Disjoint external projects cannot.
  const scanRoot = roots.reduce((outer, root) => isPathWithin(root, outer) ? root : outer, local);
  const documents = new Map<string, ScannedDraft>();
  const assets: LocalDesignFile[] = [];
  const references = new Set<string>();
  const resolved = new Set<string>();
  let incomplete = false;

  async function keepReference(file: string) {
    if (resolved.has(file)) return;
    resolved.add(file);
    references.add(pathKey(file));
    try { references.add(pathKey(await realpath(file))); }
    catch (error) { if (!isNodeError(error) || error.code !== 'ENOENT') throw error; }
  }

  // Imported packages can keep valid drafts in folders normally hidden from workspace search.
  await walkWorkspaceFiles(scanRoot, async (file) => {
    signal.throwIfAborted();
    const document = isDesignDocumentPath(file);
    const inside = isPathWithin(local, file);
    if (!document && (!inside || !assetExtensions.has(path.extname(file).slice(1).toLowerCase()))) return true;
    const relative = path.relative(local, file).split(path.sep).join('/');
    const selectable = inside && relative.split('/').every(isValidWorkspaceEntryName);
    try {
      if (path.relative(file, await realpath(file))) throw new Error('Design file moved during the scan.');
      if (document) {
        const draft = await readDesignDocumentFile(file, path.basename(file));
        // Use the same binding as the editor. A missing grant for a bound package makes cleanup incomplete.
        const resourceRoot = await designResourceDirectory(scanRoot, file, draft.document, roots, ownership, signal, { requireReadableDependencies: true });
        for (const asset of designDocumentAssetPaths(draft.document)) await keepReference(path.join(resourceRoot, asset));
        if (selectable && !isDesignLibraryPresetDocumentId(draft.document.documentId)) {
          documents.set(workspaceFilePathKey(local, relative), {
            file: { kind: 'document', path: relative, revision: draft.revision, bytes: Buffer.byteLength(draft.content) },
            id: draft.document.documentId, libraries: await resolveLibraryLinks(resourceRoot, draft.document.libraries),
          });
        }
      } else if (selectable) {
        const stats = await lstat(file);
        if (stats.isFile()) assets.push({ kind: 'asset', path: relative, bytes: stats.size, revision: assetRevision(stats) });
      }
    } catch (error) {
      signal.throwIfAborted();
      if (!isNodeError(error) || error.code !== 'ENOENT') incomplete = true;
    }
    return true;
  }, { signal, includeIgnored: true, onReadError: () => { incomplete = true; } });
  // An unreadable draft can still own a shared image, script or shader.
  const unused = incomplete ? [] : assets.filter((asset) => !references.has(pathKey(path.join(local, asset.path))));
  const drafts = Array.from(documents.values(), ({ file, libraries }) => {
    // A replacement at the same path with a different document ID no longer serves this library link.
    const libraryPaths = libraries.flatMap(([id, target]) => {
      const library = documents.get(target);
      return library?.id === id ? [library.file.path] : [];
    });
    return libraryPaths.length ? { ...file, libraryPaths } : file;
  });
  return { files: [...drafts, ...unused].sort((a, b) => a.path.localeCompare(b.path)), incomplete };
}

function assetRevision(stats: Awaited<ReturnType<typeof resolveExistingWorkspaceEntry>>['stats']) {
  return [stats.dev, stats.ino, stats.size, stats.ctimeMs, stats.mtimeMs].join(':');
}

export function localDesignCleanup(resolveLocal: () => Promise<string>, boundRoots: () => Promise<{ all: readonly string[] }>,
  ownership: DesignResourceOwnership) {
  async function locations() {
    const [local, { all }] = await Promise.all([resolveLocal(), boundRoots()]);
    return { local, roots: [...new Set([local, ...all.filter((root) => isPathWithin(root, local) || isPathWithin(local, root))])] };
  }
  return {
    async listLocalFiles(signal: AbortSignal) {
      const { local, roots } = await locations();
      return inventory(local, roots, ownership, signal);
    },
    async removeUnusedAssets(assets: readonly DesignCleanupSelection[], signal: AbortSignal) {
      if (!assets.length) return [];
      const { local, roots } = await locations();
      return withFileStateUpdates(roots, async () => {
        // Recheck dependencies under the same workspace locks used by design saves and asset imports.
        const { files } = await inventory(local, roots, ownership, signal);
        const unused = new Map(files.filter((file) => file.kind === 'asset').map((file) => [file.path, file.revision]));
        const failed: string[] = [];
        for (const asset of assets) {
          signal.throwIfAborted();
          try {
            const current = await resolveExistingWorkspaceEntry(local, asset.path);
            if (!current.stats.isFile() || unused.get(asset.path) !== asset.revision || assetRevision(current.stats) !== asset.revision) {
              failed.push(asset.path);
              continue;
            }
            await removeUnchangedFile({ ...current, root: local, relativePath: asset.path }, signal);
          } catch (error) {
            signal.throwIfAborted();
            if (!isNodeError(error) || error.code !== 'ENOENT') failed.push(asset.path);
          }
        }
        return failed;
      });
    },
  };
}
