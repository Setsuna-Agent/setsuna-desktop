import { File } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { designDocumentFileExtension, designFileKey, isDesignLibraryPresetDocumentId,
  type DesignDocument, type DesignDocumentListEntry, type DesignDocumentRef } from '../../contracts/index.js';
import { DesignThumbnail } from '../canvas/DesignThumbnail.js';
import { designFileParts } from '../catalog/DesignWorkspaceHome.js';
import { useDesignDocumentThumbnails } from '../catalog/use-design-document-thumbnails.js';
import type { DesignClient } from '../client.js';
import type { WatchDesignDirectories } from '../design-images.js';
import { DesignLibraryCatalog } from './DesignLibraryCatalog.js';

export function DesignSharedLibraries({ client, document, documentRef, watchDirectories, disabled, onLink, onUnlink, onOpen, translate: t }: Readonly<{
  client: DesignClient;
  document: DesignDocument;
  documentRef: DesignDocumentRef;
  watchDirectories?: WatchDesignDirectories;
  disabled: boolean;
  onLink(documentId: string, path: string): Promise<boolean>;
  onUnlink(path: string): Promise<boolean>;
  onOpen?(path: string): void;
  translate: RendererTranslate;
}>) {
  const [entries, setEntries] = useState<readonly DesignDocumentListEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  useEffect(() => {
    let request: AbortController | undefined;
    const load = () => {
      request?.abort();
      request = new AbortController();
      const { signal } = request;
      void client.listEntries(documentRef, signal).then((result) => {
        if (!signal.aborted) setEntries(result);
      }).catch((error: unknown) => {
        if (!signal.aborted) toast.error(t('feature.design.loadDocumentsFailed', { error: String(error) }));
      });
    };
    load();
    const stop = watchDirectories?.(['.'], load, { recursive: true, contentExtensions: [designDocumentFileExtension] });
    return () => { stop?.(); request?.abort(); };
  }, [client, documentRef, t, toast, watchDirectories]);

  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const fileRevision = useCallback((ref: DesignDocumentRef) => {
    if (designFileKey({ ...documentRef, path: ref.path }) !== designFileKey(ref)) return;
    const entry = byPath.get(ref.path);
    return entry?.revision ?? entry?.modifiedAt;
  }, [byPath, documentRef]);
  const sources = useMemo(() => {
    const linkedPaths = new Set(Object.entries(document.libraries ?? {}).flatMap(([id, path]) =>
      isDesignLibraryPresetDocumentId(id) ? [] : [path]));
    const paths = new Set([...linkedPaths, ...byPath.keys()]);
    return [...paths].flatMap((path) => {
      if (path === documentRef.path || byPath.get(path)?.libraryPreset) return [];
      const ref = { ...documentRef, path };
      const linked = linkedPaths.has(path);
      return [{ key: path, name: designFileParts(path).name, label: path, linked, canOpen: linked, ref,
        thumbnailId: JSON.stringify([designFileKey(ref), fileRevision(ref)]) }];
    });
  }, [byPath, document.libraries, documentRef, fileRevision]);
  const byThumbnail = useMemo(() => new Map(sources.map(({ thumbnailId, ref }) => [thumbnailId, ref])), [sources]);
  const observe = useDesignDocumentThumbnails(scrollRef, client, byThumbnail, true, fileRevision);
  const items = sources.map((source) => ({ ...source,
    thumbnail: <DesignThumbnail id={source.thumbnailId} observe={observe} fallback={<File size={25} strokeWidth={1.5} />} />,
  }));

  return <DesignLibraryCatalog items={items} scrollRef={scrollRef} disabled={disabled} translate={t}
    onLink={async ({ ref }, signal) => {
      const { document: source } = await client.read(ref, signal);
      signal.throwIfAborted();
      if (source.documentId === document.documentId || isDesignLibraryPresetDocumentId(source.documentId)) {
        throw new Error(t('feature.design.replacedDraft'));
      }
      await onLink(source.documentId, ref.path);
    }} onUnlink={({ key }) => onUnlink(key)} onOpen={onOpen && (({ key }) => onOpen(key))} />;
}
