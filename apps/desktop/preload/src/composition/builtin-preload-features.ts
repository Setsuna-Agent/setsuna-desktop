import type { SetsunaDesktopBridge } from '@setsuna-desktop/contracts';
import {
  definePreloadFeatureHost,
} from '@setsuna-desktop/feature-core/preload';
import type { BrowserPreloadBridgeContribution } from '@setsuna-desktop/feature-browser/contracts';
import { browserPreloadFeature } from '@setsuna-desktop/feature-browser/preload';
import type { ReviewPreloadBridgeContribution } from '@setsuna-desktop/feature-review/contracts';
import { reviewPreloadFeature } from '@setsuna-desktop/feature-review/preload';
import type { TerminalPreloadBridgeContribution } from '@setsuna-desktop/feature-terminal/contracts';
import { terminalPreloadFeature } from '@setsuna-desktop/feature-terminal/preload';
import type { UpdaterPreloadBridgeContribution } from '@setsuna-desktop/feature-updater/contracts';
import { updaterPreloadFeature } from '@setsuna-desktop/feature-updater/preload';
import type { WebDavSyncPreloadBridgeContribution } from '@setsuna-desktop/feature-webdav-sync/contracts';
import { webDavSyncPreloadFeature } from '@setsuna-desktop/feature-webdav-sync/preload';

export type DesktopPreloadBridge = SetsunaDesktopBridge
  & BrowserPreloadBridgeContribution
  & ReviewPreloadBridgeContribution
  & TerminalPreloadBridgeContribution
  & UpdaterPreloadBridgeContribution
  & WebDavSyncPreloadBridgeContribution;

const desktopPreloadBridgeKeys = [
  'browser',
  'dataRoot',
  'desktop',
  'desktopReview',
  'links',
  'networkProxy',
  'plugins',
  'runtime',
  'terminal',
  'updater',
  'webdavSync',
  'windowControls',
  'windowsSandbox',
  'workspaceApps',
] as const satisfies readonly (keyof DesktopPreloadBridge)[];

const preloadFeatures = definePreloadFeatureHost<DesktopPreloadBridge>({
  bridgeKeys: desktopPreloadBridgeKeys,
  features: [
    browserPreloadFeature,
    reviewPreloadFeature,
    terminalPreloadFeature,
    updaterPreloadFeature,
    webDavSyncPreloadFeature,
  ],
});

export function composeBuiltinPreloadBridge(hostBridge: SetsunaDesktopBridge): DesktopPreloadBridge {
  return preloadFeatures.compose(hostBridge);
}
