import { DOCUMENT_PREVIEW_MAX_BYTES, getDocumentPreviewFormat } from '@setsuna-desktop/contracts';
import type { DocumentPreviewProps } from '@setsuna-desktop/renderer-contracts/workspace';
import { useEffect, useRef, useState } from 'react';
import { loadDocumentPreviewFactory, type DocumentPreviewViewer } from './document-preview-engine.js';

export function useDocumentPreview({ filePath, load }: DocumentPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let viewer: DocumentPreviewViewer | undefined;
    // Each load owns a detached surface so a late result cannot paint over the next document.
    const surface = document.createElement('div');
    surface.className = 'desktop-document-preview__surface';
    container.replaceChildren(surface);
    setState({ loading: true, error: null });
    const fail = (error: unknown) => {
      if (cancelled) return;
      // Progressive layout may fail after load() has already displayed the first page.
      const failedViewer = viewer;
      viewer = undefined;
      failedViewer?.destroy();
      setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    };
    void (async () => {
      const format = getDocumentPreviewFormat(filePath);
      if (!format) throw new Error('Unsupported document format.');
      const factory = await loadDocumentPreviewFactory(format);
      if (cancelled) return;
      const data = await load();
      if (cancelled) return;
      if (data.byteLength > DOCUMENT_PREVIEW_MAX_BYTES) throw new Error('Document exceeds the 32 MiB preview limit.');
      viewer = factory(surface, fail);
      // Own the transferable buffer: the parser must not detach a caller's cached bytes.
      await viewer.load(new Uint8Array(data).buffer);
      if (!cancelled) setState((current) => current.error ? current : { loading: false, error: null });
    })().catch(fail);
    return () => {
      cancelled = true;
      viewer?.destroy();
      viewer = undefined;
      surface.remove();
    };
  }, [filePath, load]);
  return { containerRef, ...state };
}
