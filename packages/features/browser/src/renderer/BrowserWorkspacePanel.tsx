import type {
  BrowserDesktopBridge,
  BrowserPanelDescriptor,
  BrowserPanelMetadataPatch,
  BrowserReloadShortcutBindings,
} from '../contracts/index.js';
import type { WorkspacePanelSlotProps } from '@setsuna-desktop/renderer-contracts/workspace';
import { createContext, useContext, type ReactNode } from 'react';
import { BrowserPanel } from './BrowserPanel.js';
import type {
  BrowserNotify,
  BrowserScreenshotAttachmentHandler,
  BrowserSelectFieldComponent,
} from './types.js';

export type BrowserWorkspacePanelBinding = Readonly<{
  panel: BrowserPanelDescriptor;
  resizeHandle?: ReactNode;
  onPanelMetadataChange(panelId: string, patch: BrowserPanelMetadataPatch): void;
  onScreenshotAttachment?: BrowserScreenshotAttachmentHandler;
}>;

export type BrowserWorkspacePanelHost = Readonly<{
  bridge: BrowserDesktopBridge | null;
  notify: BrowserNotify;
  openExternal?(url: string): void;
  reloadShortcutBindings?: BrowserReloadShortcutBindings;
  resolveBinding(surfaceInstanceId: string): BrowserWorkspacePanelBinding | null;
  selectField?: BrowserSelectFieldComponent;
}>;

const BrowserWorkspacePanelHostContext = createContext<BrowserWorkspacePanelHost | null>(null);

export function BrowserWorkspacePanelHostProvider({
  children,
  host,
}: Readonly<{
  children: ReactNode;
  host: BrowserWorkspacePanelHost;
}>) {
  return (
    <BrowserWorkspacePanelHostContext.Provider value={host}>
      {children}
    </BrowserWorkspacePanelHostContext.Provider>
  );
}

export function BrowserWorkspacePanel(props: WorkspacePanelSlotProps) {
  const host = useContext(BrowserWorkspacePanelHostContext);
  const binding = host?.resolveBinding(props.surfaceInstanceId);
  if (!host || !binding) return null;
  return (
    <BrowserPanel
      bridge={host.bridge}
      hidden={!props.visible}
      notify={host.notify}
      openExternal={host.openExternal}
      panel={binding.panel}
      placement={props.placement}
      reloadShortcutBindings={host.reloadShortcutBindings}
      resizeHandle={binding.resizeHandle}
      selectField={host.selectField}
      translate={props.translate}
      onPanelMetadataChange={binding.onPanelMetadataChange}
      onScreenshotAttachment={binding.onScreenshotAttachment}
    />
  );
}
