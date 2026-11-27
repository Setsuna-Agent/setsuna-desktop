import type { DesignCanvasSelection, RenderDesignChat } from './agent/DesignChatBridge.js';
import { lazy, Suspense } from 'react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designFileKey, type DesignDocumentRef } from '../contracts/index.js';
import type { DesignLibraryColorScheme } from '../contracts/design-library-presets.js';
import type { DesignClient } from './client.js';
import type { WatchDesignRootDirectories } from './catalog/use-design-document-lists.js';
import type { WatchDesignDirectories } from './design-images.js';
import { loadDesignLayoutEngine } from './canvas/design-layout-engine.js';
import { DesignExportPreviewProvider } from './export/DesignExportPreviewProvider.js';

const LazyDesignEditor = lazy(async () => {
  const [{ default: DesignEditor }, layoutEngine] = await Promise.all([import('./DesignEditor.js'), loadDesignLayoutEngine()]);
  return { default: (props: DesignDocumentSurfaceProps) => <DesignEditor {...props} layoutEngine={layoutEngine} /> };
});

export type DesignLibraryPreviewTarget = Readonly<{ path: string; documentId: string; name: string; homepage: string }>;

export type DesignDocumentSurfaceProps = Readonly<{
  client: DesignClient;
  renderChat?: RenderDesignChat;
  documentRef: DesignDocumentRef;
  projects?: readonly WorkspaceProject[];
  onFileAction?(destination?: DesignDocumentRef): void;
  readOnly?: boolean;
  libraryPreview?: DesignLibraryColorScheme;
  colorScheme?: DesignLibraryColorScheme;
  visible?: boolean;
  fileRevision?: string;
  expectedDocumentId?: string;
  chatActivity?: { request?: { threadId: string; id: string }; networkAccess: boolean;
    connectSelection?(canvas: DesignCanvasSelection): () => void };
  shouldRefresh?(): boolean;
  watchDirectories?: WatchDesignRootDirectories;
  watchAssetDirectories?: WatchDesignDirectories;
  onOpenLibrary?(path: string): void;
  onOpenPresetLibrary?(source: DesignLibraryPreviewTarget): void;
  onDocumentMissing?(): void;
  translate: RendererTranslate;
}>;

export function DesignDocumentSurface(props: DesignDocumentSurfaceProps) {
  return <DesignExportPreviewProvider key={designFileKey(props.documentRef)} assets={props.client.assets}
    visible={props.visible !== false} translate={props.translate}>
    <Suspense fallback={null}><LazyDesignEditor {...props} /></Suspense>
  </DesignExportPreviewProvider>;
}
