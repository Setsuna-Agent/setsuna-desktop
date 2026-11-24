import { useEffect, useMemo, useState } from 'react';
import { designDocumentFileExtension, designFileKey, findBundledDesignLibrary, type DesignDocument, type DesignDocumentRef,
  type DesignLibraryLinks } from '../../contracts/index.js';
import type { DesignClient } from '../client.js';
import type { WatchDesignDirectories } from '../design-images.js';
import { buildDesignLibraryResources, emptyDesignLibraryResources } from './design-library-resources.js';
import { readDesignLibraryFiles, type DesignLibraryEntry, type DesignLibraryFiles } from './read-design-library-files.js';

export function useDesignLibraryResources(
  client: Pick<DesignClient, 'read'>, ref: DesignDocumentRef, document: DesignDocument | undefined, watchDirectories?: WatchDesignDirectories,
) {
  const documentId = document?.documentId;
  const scope = JSON.stringify([designFileKey(ref), documentId]);
  const linksKey = libraryLinksKey(document?.libraries);
  const [loaded, setLoaded] = useState<Readonly<{ scope: string; files: DesignLibraryFiles }>>();
  const files = loaded?.scope === scope && linksKey !== '[]' ? loaded.files : undefined;

  useEffect(() => {
    if (!documentId || linksKey === '[]') return;
    const links = JSON.parse(linksKey) as DesignLibraryEntry[];
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      void readDesignLibraryFiles(client, ref, documentId, links, signal).then((files) => {
        if (signal.aborted) return;
        setLoaded((current) => current?.scope === scope && sameLibraryFiles(current.files, files) ? current : { scope, files });
      });
    };
    refresh();
    if (links.every(([, path]) => findBundledDesignLibrary(path))) return () => request?.abort();
    // Follow changes to the linked files and their own library dependencies throughout the root.
    const stop = watchDirectories?.(['.'], refresh, { recursive: true, contentExtensions: [designDocumentFileExtension] });
    window.addEventListener('focus', refresh);
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

function sameLibraryFiles(previous: DesignLibraryFiles, next: DesignLibraryFiles) {
  if (previous.size !== next.size) return false;
  for (const [id, file] of next) {
    const before = previous.get(id);
    if (before?.path !== file.path || before.snapshot.revision !== file.snapshot.revision) return false;
  }
  return true;
}
