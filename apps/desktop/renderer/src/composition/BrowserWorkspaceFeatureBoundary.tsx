import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import {
  BrowserFavicon,
  BrowserFeatureIcon,
  BrowserWorkspacePanelHostProvider,
  latestBrowserOpenRequest,
  type BrowserNotify,
  type BrowserScreenshotAttachmentHandler,
  type BrowserWorkspacePanelBinding,
  type BrowserWorkspacePanelHost,
} from '@setsuna-desktop/feature-browser/renderer';
import type { ReactNode } from 'react';

export type {
  BrowserNotify,
  BrowserScreenshotAttachmentHandler,
  BrowserWorkspacePanelBinding,
  BrowserWorkspacePanelHost,
};

export { BrowserFavicon, BrowserFeatureIcon };

export function BrowserWorkspaceFeatureBoundary({
  children,
  host,
}: Readonly<{
  children: ReactNode;
  host: BrowserWorkspacePanelHost;
}>) {
  return <BrowserWorkspacePanelHostProvider host={host}>{children}</BrowserWorkspacePanelHostProvider>;
}

export function latestBrowserFeatureOpenRequest(events: RuntimeEvent[]) {
  return latestBrowserOpenRequest(events);
}
