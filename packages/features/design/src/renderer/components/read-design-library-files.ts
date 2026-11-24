import type { DesignDocumentRef, DesignSnapshot } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';

type LibraryFile = Readonly<{ path: string; snapshot: DesignSnapshot }>;
export type DesignLibraryFiles = ReadonlyMap<string, LibraryFile>;
export type DesignLibraryEntry = readonly [documentId: string, path: string];

export async function readDesignLibraryFiles(client: Pick<DesignClient, 'read'>, ref: DesignDocumentRef, documentId: string,
  links: readonly DesignLibraryEntry[], signal: AbortSignal,
): Promise<DesignLibraryFiles> {
  const pending: DesignLibraryEntry[] = [];
  const seen = new Set<string>();
  const files = new Map<string, LibraryFile>();
  function schedule(entries: readonly DesignLibraryEntry[]) {
    for (const [id, path] of entries) {
      const key = JSON.stringify([id, path]);
      if (id === documentId || files.has(id) || seen.has(key)) continue;
      seen.add(key);
      pending.push([id, path]);
    }
  }
  schedule(links);
  for (let first = 0; first < pending.length && !signal.aborted;) {
    const batch = pending.slice(first, first + 8);
    first += batch.length;
    const snapshots = await Promise.all(batch.filter(([id]) => !files.has(id)).map(async ([id, path]) => {
      const snapshot = await client.read({ ...ref, path }, signal).catch(() => undefined);
      return snapshot?.document.documentId === id ? { path, snapshot } : undefined;
    }));
    for (const file of snapshots) {
      if (!file || files.has(file.snapshot.document.documentId)) continue;
      files.set(file.snapshot.document.documentId, file);
      schedule(Object.entries(file.snapshot.document.libraries ?? {}));
    }
  }
  return files;
}
