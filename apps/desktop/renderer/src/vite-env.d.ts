/// <reference types="vite/client" />

import type {
  SetsunaDesktopBridge,
} from '@setsuna-desktop/contracts';
import type { BrowserPreloadBridgeContribution } from '@setsuna-desktop/feature-browser/contracts';
import type { NetworkProxyPreloadBridgeContribution } from '@setsuna-desktop/feature-network-proxy/contracts';
import type { ReviewPreloadBridgeContribution } from '@setsuna-desktop/feature-review/contracts';
import type { TerminalPreloadBridgeContribution } from '@setsuna-desktop/feature-terminal/contracts';
import type { UpdaterPreloadBridgeContribution } from '@setsuna-desktop/feature-updater/contracts';
import type { WebDavSyncPreloadBridgeContribution } from '@setsuna-desktop/feature-webdav-sync/contracts';
import type { WorkspaceAppsPreloadBridgeContribution } from '@setsuna-desktop/feature-workspace-apps/contracts';

declare global {
  interface Window {
    setsunaDesktop?: SetsunaDesktopBridge
      & BrowserPreloadBridgeContribution
      & NetworkProxyPreloadBridgeContribution
      & ReviewPreloadBridgeContribution
      & TerminalPreloadBridgeContribution
      & UpdaterPreloadBridgeContribution
      & WebDavSyncPreloadBridgeContribution
      & WorkspaceAppsPreloadBridgeContribution;
  }
}
