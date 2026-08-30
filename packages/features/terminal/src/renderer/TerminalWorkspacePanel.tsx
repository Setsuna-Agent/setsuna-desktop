import type {
  DesktopTerminalSession,
  TerminalDesktopBridge,
} from '../contracts/index.js';
import type { WorkspacePanelSlotProps } from '@setsuna-desktop/renderer-contracts/workspace';
import { createContext, useContext, type ReactNode } from 'react';
import { LazyTerminalPane } from './LazyTerminalPane.js';

export type TerminalWorkspacePanelHost = Readonly<{
  bridge: TerminalDesktopBridge | null;
  openExternal?(url: string): Promise<unknown>;
  resolveSession(panelId: string): DesktopTerminalSession | null;
  subscribeAppearanceChange?(listener: () => void): () => void;
  updateTitle(panelId: string, title: string): void;
}>;

const TerminalWorkspacePanelHostContext = createContext<TerminalWorkspacePanelHost | null>(null);

export function TerminalWorkspacePanelHostProvider({
  children,
  host,
}: Readonly<{
  children: ReactNode;
  host: TerminalWorkspacePanelHost;
}>) {
  return (
    <TerminalWorkspacePanelHostContext.Provider value={host}>
      {children}
    </TerminalWorkspacePanelHostContext.Provider>
  );
}

export function TerminalWorkspacePanel(props: WorkspacePanelSlotProps) {
  const host = useContext(TerminalWorkspacePanelHostContext);
  if (!host) return null;
  return (
    <section className="desktop-workspace-terminal-panel" aria-label={props.translate('feature.terminal.label')}>
      <LazyTerminalPane
        bridge={host.bridge}
        openExternal={host.openExternal}
        session={host.resolveSession(props.panelId)}
        subscribeAppearanceChange={host.subscribeAppearanceChange}
        translate={props.translate}
        onTitleChange={(title) => host.updateTitle(props.panelId, title)}
      />
    </section>
  );
}
