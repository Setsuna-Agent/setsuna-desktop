import {
  WorkspaceAppGlyph,
  WorkspaceAppsTopbarHostProvider,
  readPreferredWorkspaceAppId,
  writePreferredWorkspaceAppId,
  type WorkspaceAppsTopbarHost,
} from '@setsuna-desktop/feature-workspace-apps/renderer';
import type { ReactNode } from 'react';

export type { WorkspaceAppsTopbarHost };
export { WorkspaceAppGlyph, readPreferredWorkspaceAppId, writePreferredWorkspaceAppId };

export function WorkspaceAppsFeatureBoundary({
  children,
  host,
}: Readonly<{
  children: ReactNode;
  host: WorkspaceAppsTopbarHost | null;
}>) {
  return <WorkspaceAppsTopbarHostProvider host={host}>{children}</WorkspaceAppsTopbarHostProvider>;
}
