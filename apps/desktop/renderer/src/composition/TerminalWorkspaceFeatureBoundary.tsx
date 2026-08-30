import {
  TerminalWorkspacePanelHostProvider,
  clearTerminalRestoreBuffer,
  type TerminalWorkspacePanelHost,
} from '@setsuna-desktop/feature-terminal/renderer';
import type { ReactNode } from 'react';

export type { TerminalWorkspacePanelHost };

export function TerminalWorkspaceFeatureBoundary({
  children,
  host,
}: Readonly<{
  children: ReactNode;
  host: TerminalWorkspacePanelHost;
}>) {
  return <TerminalWorkspacePanelHostProvider host={host}>{children}</TerminalWorkspacePanelHostProvider>;
}

export function clearTerminalWorkspaceRestoreBuffer(sessionId: string): void {
  clearTerminalRestoreBuffer(sessionId);
}
