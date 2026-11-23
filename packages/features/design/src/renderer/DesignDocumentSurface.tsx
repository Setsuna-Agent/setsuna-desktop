import type { DesignCanvasSelection, RenderDesignChat } from './agent/DesignChatBridge.js';
import { lazy, Suspense } from 'react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { designFileKey, type DesignDocumentRef } from '../contracts/index.js';
import type { DesignClient } from './client.js';
import type { WatchDesignRootDirectories } from './catalog/use-design-document-lists.js';
import type { WatchDesignDirectories } from './design-images.js';

const LazyDesignEditor = lazy(async () => {
  const [{ default: DesignEditor }, { loadYoga }] = await Promise.all([import('./DesignEditor.js'), import('yoga-layout/load')]);
  const layoutEngine = await loadYoga();
  return { default: (props: DesignDocumentSurfaceProps) => <DesignEditor {...props} layoutEngine={layoutEngine} /> };
});

export type DesignDocumentSurfaceProps = Readonly<{
  client: DesignClient;
  renderChat?: RenderDesignChat;
  documentRef: DesignDocumentRef;
  projects?: readonly WorkspaceProject[];
  onFileAction?(destination?: DesignDocumentRef): void;
  readOnly?: boolean;
  fileRevision?: string;
  expectedDocumentId?: string;
  chatActivity?: { request?: { threadId: string; id: string }; networkAccess: boolean;
    connectSelection?(canvas: DesignCanvasSelection): () => void };
  shouldRefresh?(): boolean;
  watchDirectories?: WatchDesignRootDirectories;
  watchAssetDirectories?: WatchDesignDirectories;
  onOpenLibrary?(path: string): void;
  onDocumentMissing?(): void;
  translate: RendererTranslate;
}>;

export function DesignDocumentSurface(props: DesignDocumentSurfaceProps) {
  return <Suspense fallback={null}><LazyDesignEditor key={designFileKey(props.documentRef)} {...props} /></Suspense>;
}
