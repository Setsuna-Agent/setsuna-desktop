import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignDocumentRef } from '../../contracts/index.js';
import { designLibraryPresets, isDesignLibraryPresetDocumentId, type DesignLibraryColorScheme, type DesignLibraryPresetId } from '../../contracts/design-library-presets.js';
import type { DesignClient } from '../client.js';
import type { DesignLibraryPreviewTarget } from '../DesignDocumentSurface.js';
import { DesignLibraryCatalog } from './DesignLibraryCatalog.js';

const covers: Record<DesignLibraryPresetId, Record<DesignLibraryColorScheme, string>> = {
  'shadcn-ui': {
    light: new URL('../../resources/design-library-covers/shadcn-ui-light.webp', import.meta.url).href,
    dark: new URL('../../resources/design-library-covers/shadcn-ui-dark.webp', import.meta.url).href,
  },
  beui: {
    light: new URL('../../resources/design-library-covers/beui-light.webp', import.meta.url).href,
    dark: new URL('../../resources/design-library-covers/beui-dark.webp', import.meta.url).href,
  },
};

export function DesignLibraryPresets({ document, documentRef, client, colorScheme, disabled, onLink, onUnlink, onOpen, translate }: Readonly<{
  document: DesignDocument;
  documentRef: DesignDocumentRef;
  client: DesignClient;
  colorScheme?: DesignLibraryColorScheme;
  disabled: boolean;
  onLink(documentId: string, path: string): Promise<boolean>;
  onUnlink(path: string): Promise<boolean>;
  onOpen?(source: DesignLibraryPreviewTarget): void;
  translate: RendererTranslate;
}>) {
  const links = Object.entries(document.libraries ?? {});
  const items = designLibraryPresets.map(({ id, name, homepage }) => {
    const linkedPath = links.find(([documentId]) => isDesignLibraryPresetDocumentId(documentId, id))?.[1];
    return { key: id, name, homepage, linkedPath, linked: Boolean(linkedPath), canOpen: true,
      thumbnail: <img className="design-library__source-cover" src={covers[id][colorScheme ?? 'light']} alt=""
        width={960} height={540} loading="lazy" decoding="async" draggable={false} /> };
  });

  async function preparePreset(presetId: DesignLibraryPresetId, signal: AbortSignal) {
    const source = await client.prepareLibraryPreset({ ref: documentRef, presetId }, signal);
    signal.throwIfAborted();
    return source;
  }

  return <DesignLibraryCatalog items={items} disabled={disabled} translate={translate}
    linkFailure="feature.design.linkPresetFailed"
    onLink={async ({ key }, signal) => {
      const { documentId, path } = await preparePreset(key, signal);
      await onLink(documentId, path);
    }} onUnlink={({ linkedPath }) => {
      if (linkedPath) return onUnlink(linkedPath);
    }}
    onOpen={onOpen && (async ({ key, name, homepage }, signal) => {
      const { documentId, path } = await preparePreset(key, signal);
      onOpen({ documentId, path, name, homepage });
    })} />;
}
