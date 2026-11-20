import { lazy, Suspense } from 'react';
import { workspaceFileKey } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocumentRef } from '../contracts/index.js';
import type { DesignClient } from './client.js';
import type { WatchDesignDirectories } from './design-images.js';

const LazyDesignEditor = lazy(async () => {
  const [{ default: DesignEditor }, { loadYoga }] = await Promise.all([import('./DesignEditor.js'), import('yoga-layout/load')]);
  const layoutEngine = await loadYoga();
  return { default: (props: DesignDocumentSurfaceProps) => <DesignEditor {...props} layoutEngine={layoutEngine} /> };
});

export type DesignDocumentSurfaceProps = Readonly<{
  client: DesignClient;
  documentRef: DesignDocumentRef;
  readOnly?: boolean;
  fileRevision?: string;
  watchChanges?: (changed: () => void) => () => void;
  watchAssetDirectories?: WatchDesignDirectories;
  layersToggleTarget?: HTMLElement;
  onOpenLibrary?(path: string): void;
  onDocumentMissing?(): void;
  translate: RendererTranslate;
}>;

export function DesignDocumentSurface(props: DesignDocumentSurfaceProps) {
  return <Suspense fallback={null}><LazyDesignEditor key={workspaceFileKey(props.documentRef)} {...props} /></Suspense>;
}
