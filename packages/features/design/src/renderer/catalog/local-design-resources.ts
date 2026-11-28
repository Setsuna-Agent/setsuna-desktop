import { designFileKey } from '../../contracts/operations.js';
import type { LocalDesignFile } from '../../contracts/design-cleanup.js';
import type { DesignClient } from '../client.js';
import { withPausedDesignEdits } from '../document/pending-design-edits.js';
import { notifyDesignFontCatalogChanged } from '../text/design-font-catalog-events.js';

export type DesignStorageResource = LocalDesignFile | Readonly<{ kind: 'font'; id: string; name: string }>;

export function designStorageResourceKey(item: DesignStorageResource) {
  return item.kind === 'font' ? item.id : JSON.stringify([item.path, item.revision]);
}

function orderCleanupSelection(selected: readonly DesignStorageResource[]) {
  const documents = selected.filter((item) => item.kind === 'document');
  const byPath = new Map(documents.map((file) => [file.path, { file, dependents: 0 }]));
  for (const file of documents) {
    for (const path of file.libraryPaths ?? []) {
      const library = byPath.get(path);
      if (library) library.dependents++;
    }
  }
  // Release each library after all its selected dependents. Runtime still checks live references on deletion.
  const ordered = documents.filter((file) => byPath.get(file.path)!.dependents === 0);
  for (const file of ordered) {
    for (const path of file.libraryPaths ?? []) {
      const library = byPath.get(path);
      if (!library) continue;
      library.dependents--;
      if (library.dependents === 0) ordered.push(library.file);
    }
  }
  const blocked = documents.filter((file) => byPath.get(file.path)!.dependents > 0);
  return [...ordered, ...blocked, ...selected.filter((item) => item.kind !== 'document')];
}

export async function listDesignStorageResources(client: DesignClient, signal: AbortSignal) {
  const [inventory, fonts] = await Promise.allSettled([client.listLocalFiles(signal), client.fonts.list(signal)]);
  signal.throwIfAborted();
  if (inventory.status === 'rejected' && fonts.status === 'rejected') throw inventory.reason;
  const resources: DesignStorageResource[] = inventory.status === 'fulfilled' ? [...inventory.value.files] : [];
  if (fonts.status === 'fulfilled') {
    for (const { id, name } of fonts.value) resources.push({ kind: 'font', id, name });
  }
  return { resources, incomplete: inventory.status === 'rejected' || inventory.value.incomplete || fonts.status === 'rejected' };
}

export async function cleanDesignStorageResources(client: DesignClient, selected: readonly DesignStorageResource[], signal: AbortSignal) {
  const failed = new Set<string>();
  const assets: LocalDesignFile[] = [];
  let fontsChanged = false;
  try {
    for (const item of orderCleanupSelection(selected)) {
      signal.throwIfAborted();
      try {
        if (item.kind === 'asset') assets.push(item);
        else if (item.kind === 'font') {
          await client.fonts.remove(item.id, signal);
          fontsChanged = true;
        } else {
          const ref = { storageId: 'local', path: item.path };
          const owner = await client.resolveResourceRoot(ref, signal);
          // An imported package can be open under its own grant as well as the local directory.
          const keys = new Set([designFileKey(ref), designFileKey(owner)]);
          const deleted = await withPausedDesignEdits(client, keys, async () => {
            await client.delete({ ...ref, expectedRevision: item.revision }, signal);
          });
          if (!deleted) failed.add(designStorageResourceKey(item));
        }
      } catch {
        signal.throwIfAborted();
        failed.add(designStorageResourceKey(item));
      }
    }
  } finally {
    if (fontsChanged) notifyDesignFontCatalogChanged();
  }
  if (assets.length) {
    let remaining: ReadonlySet<string>;
    try { remaining = new Set(await client.removeUnusedAssets(assets, signal)); }
    catch {
      signal.throwIfAborted();
      remaining = new Set(assets.map((asset) => asset.path));
    }
    for (const asset of assets) if (remaining.has(asset.path)) failed.add(designStorageResourceKey(asset));
  }
  return failed;
}
