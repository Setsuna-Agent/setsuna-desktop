import { useCallback, useEffect, useMemo, useReducer, type RefObject } from 'react';
import type { DesignDocumentRef } from '../../contracts/index.js';
import { useDesignThumbnailRenderer } from '../canvas/DesignThumbnail.js';
import type { DesignClient } from '../client.js';
import { createDesignPreviewFontLoader, designFontCatalogChannel } from '../text/design-font-loader.js';

export function useDesignDocumentThumbnails(list: RefObject<HTMLElement>, client: DesignClient,
  sources: ReadonlyMap<string, DesignDocumentRef>, open: boolean, fileRevision?: (ref: DesignDocumentRef) => string | undefined,
) {
  const [fontCatalogRevision, refreshFonts] = useReducer((revision: number) => revision + 1, 0);
  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') return;
    const channel = new BroadcastChannel(designFontCatalogChannel);
    channel.addEventListener('message', refreshFonts);
    return () => channel.close();
  }, []);
  const fonts = useMemo(() => createDesignPreviewFontLoader(client.fonts), [client, fontCatalogRevision]);
  useEffect(() => () => fonts.dispose(), [fonts]);

  const render = useCallback(async (id: string, signal: AbortSignal) => {
    const ref = sources.get(id);
    if (!ref) return;
    const { renderDesignCatalogPreview } = await import('./design-catalog-preview.js');
    signal.throwIfAborted();
    return renderDesignCatalogPreview(client, ref, signal, fonts);
  }, [client, fonts, sources]);
  return useDesignThumbnailRenderer(list, render, open, fonts, fileRevision);
}
