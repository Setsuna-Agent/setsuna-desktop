import {
  ArtifactBrowserNavigationProvider,
  type ArtifactBrowserOpenHandler,
} from '@setsuna-desktop/feature-artifact/renderer';
import type { PropsWithChildren } from 'react';

export function ArtifactFeatureNavigationBoundary({
  children,
  onOpenBrowser,
}: PropsWithChildren<Readonly<{ onOpenBrowser: ArtifactBrowserOpenHandler }>>) {
  return (
    <ArtifactBrowserNavigationProvider onOpenBrowser={onOpenBrowser}>
      {children}
    </ArtifactBrowserNavigationProvider>
  );
}
