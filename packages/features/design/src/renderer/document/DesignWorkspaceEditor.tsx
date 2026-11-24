import { useCallback, type ReactNode } from 'react';
import type { DesignDocumentRef } from '../../contracts/index.js';
import { DesignDocumentSurface, type DesignDocumentSurfaceProps } from '../DesignDocumentSurface.js';
import type { WatchDesignRootDirectories } from '../catalog/use-design-document-lists.js';
import type { WatchDesignDirectories } from '../design-images.js';

type Props = Pick<DesignDocumentSurfaceProps, 'client' | 'colorScheme' | 'documentRef' | 'onOpenLibrary' | 'onOpenPresetLibrary' | 'projects' | 'renderChat' | 'translate' | 'visible'> & Readonly<{
  selected: boolean;
  toolbar?: ReactNode;
  linkedProject: string | null;
  workspaceRoot?: string;
  watchDirectories: WatchDesignRootDirectories;
  canRefresh(ref: DesignDocumentRef): boolean;
  onDocumentBusy(ref: DesignDocumentRef, busy: boolean): void;
  onDocumentFileAction(ref: DesignDocumentRef, destination?: DesignDocumentRef): void;
}>;

export function DesignWorkspaceEditor({ documentRef, selected, toolbar, linkedProject, workspaceRoot, watchDirectories,
  canRefresh, onDocumentBusy, onDocumentFileAction, renderChat, ...surface }: Props) {
  const onBusyChange = useCallback((busy: boolean) => onDocumentBusy(documentRef, busy), [documentRef, onDocumentBusy]);
  const onFileAction = useCallback((destination?: DesignDocumentRef) => onDocumentFileAction(documentRef, destination),
    [documentRef, onDocumentFileAction]);
  const shouldRefresh = useCallback(() => canRefresh(documentRef), [canRefresh, documentRef]);
  const watchAssetDirectories = useCallback<WatchDesignDirectories>((...args) =>
    workspaceRoot ? watchDirectories(workspaceRoot, ...args) : () => undefined, [watchDirectories, workspaceRoot]);

  return <div className="design-workspace__editing" aria-hidden={!selected || undefined} {...{ inert: selected ? undefined : '' }}>
    {toolbar}
    <div className="design-workspace__editor">
      <DesignDocumentSurface {...surface} documentRef={documentRef} onFileAction={onFileAction} onDocumentMissing={onFileAction}
        readOnly={!shouldRefresh()} shouldRefresh={shouldRefresh} watchAssetDirectories={watchAssetDirectories}
        renderChat={renderChat && ((binding) => renderChat({ ...binding, onBusyChange }, linkedProject))} />
    </div>
  </div>;
}
