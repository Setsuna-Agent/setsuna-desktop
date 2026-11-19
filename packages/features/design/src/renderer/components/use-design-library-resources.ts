import { useEffect, useMemo, useState } from 'react';
import { workspaceFileKey } from '@setsuna-desktop/contracts';
import { designDocumentFileExtension, type DesignDocument, type DesignDocumentRef, type DesignLibraryLinks, type DesignSnapshot } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import type { WatchDesignDirectories } from '../design-images.js';
import { buildDesignLibraryResources, emptyDesignLibraryResources } from './design-library-resources.js';

type LibraryFile = Readonly<{ path: string; snapshot: DesignSnapshot }>;
type LibraryFiles = ReadonlyMap<string, LibraryFile>;
type LibraryEntry = readonly [documentId: string, path: string];

export function useDesignLibraryResources(
  client: Pick<DesignClient, 'read'>, ref: DesignDocumentRef, document: DesignDocument | undefined, watchDirectories?: WatchDesignDirectories,
) {
  const documentId = document?.documentId;
  const scope = JSON.stringify([workspaceFileKey(ref), documentId]);
  const linksKey = libraryLinksKey(document?.libraries);
  const [loaded, setLoaded] = useState<Readonly<{ scope: string; files: LibraryFiles }>>();
  const files = loaded?.scope === scope && linksKey !== '[]' ? loaded.files : undefined;

  useEffect(() => {
    if (!documentId || linksKey === '[]') return;
    const links = JSON.parse(linksKey) as LibraryEntry[];
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      void readLibraryFiles(client, ref, documentId, links, signal).then((files) => {
        if (signal.aborted) return;
        setLoaded((current) => current?.scope === scope && sameLibraryFiles(current.files, files) ? current : { scope, files });
      });
    };
    // Follow changes to the linked files and their own library dependencies throughout the root.
    const stop = watchDirectories?.(['.'], refresh, { recursive: true, contentExtensions: [designDocumentFileExtension] });
    window.addEventListener('focus', refresh);
    refresh();
    return () => {
      request?.abort();
      stop?.();
      window.removeEventListener('focus', refresh);
    };
  }, [client, documentId, linksKey, ref, scope, watchDirectories]);

  return useMemo(() => documentId && files
    ? buildDesignLibraryResources(documentId, [...files.values()].map(({ snapshot }) => snapshot.document))
    : emptyDesignLibraryResources, [documentId, files]);
}

function libraryLinksKey(links: DesignLibraryLinks | undefined) {
  return JSON.stringify(Object.entries(links ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

async function readLibraryFiles(client: Pick<DesignClient, 'read'>, ref: DesignDocumentRef, documentId: string,
  links: readonly LibraryEntry[], signal: AbortSignal,
): Promise<LibraryFiles> {
  const pending: LibraryEntry[] = [];
  const seen = new Set<string>();
  const files = new Map<string, LibraryFile>();
  function schedule(entries: readonly LibraryEntry[]) {
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

function sameLibraryFiles(previous: LibraryFiles, next: LibraryFiles) {
  if (previous.size !== next.size) return false;
  for (const [id, file] of next) {
    const before = previous.get(id);
    if (before?.path !== file.path || before.snapshot.revision !== file.snapshot.revision) return false;
  }
  return true;
}
