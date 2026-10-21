import {
  TerminalWorkspacePanelHostProvider,
  TerminalActions,
  clearTerminalRestoreBuffer,
  type TerminalWorkspacePanelHost,
} from '@setsuna-desktop/feature-terminal/renderer';
import type { ReactNode } from 'react';
import { useI18n } from '../shared/i18n/I18nProvider.js';

export type { TerminalWorkspacePanelHost };
export { TerminalActionsHostProvider, type TerminalActionsHost } from '@setsuna-desktop/feature-terminal/renderer';

export function TerminalFeatureActions({ projectId, projectName }: {
  projectId: string;
  projectName: string;
}) {
  const { t } = useI18n();
  return <TerminalActions key={projectId} project={{ id: projectId, name: projectName }} translate={t} />;
}

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
