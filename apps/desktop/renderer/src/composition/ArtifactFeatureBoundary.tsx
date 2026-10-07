import {
  ArtifactNavigationProvider,
  type ArtifactBrowserOpenHandler,
} from '@setsuna-desktop/feature-artifact/renderer';
import type { PropsWithChildren } from 'react';

export function ArtifactFeatureNavigationBoundary({
  children,
  onOpenBrowser,
  projectId,
  onShowInFiles,
}: PropsWithChildren<Readonly<{
  onOpenBrowser: ArtifactBrowserOpenHandler;
  projectId?: string;
  onShowInFiles(filePath: string): Promise<void>;
}>>) {
  return (
    <ArtifactNavigationProvider onOpenBrowser={onOpenBrowser} projectId={projectId} onShowInFiles={onShowInFiles}>
      {children}
    </ArtifactNavigationProvider>
  );
}
