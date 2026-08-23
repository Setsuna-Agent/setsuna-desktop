import type { SetsunaDesktopBridge } from '@setsuna-desktop/contracts';
import {
  createPreloadBridgeBuilder,
  type PreloadFeatureModule,
} from '@setsuna-desktop/feature-core/preload';
import type { BrowserPreloadBridgeContribution } from '@setsuna-desktop/feature-browser/contracts';
import { browserPreloadFeature } from '@setsuna-desktop/feature-browser/preload';
import type { ReviewPreloadBridgeContribution } from '@setsuna-desktop/feature-review/contracts';
import { reviewPreloadFeature } from '@setsuna-desktop/feature-review/preload';
import type { TerminalPreloadBridgeContribution } from '@setsuna-desktop/feature-terminal/contracts';
import { terminalPreloadFeature } from '@setsuna-desktop/feature-terminal/preload';

export type DesktopPreloadBridge = SetsunaDesktopBridge
  & BrowserPreloadBridgeContribution
  & ReviewPreloadBridgeContribution
  & TerminalPreloadBridgeContribution;

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

export const builtinPreloadFeatures = [
  browserPreloadFeature,
  reviewPreloadFeature,
  terminalPreloadFeature,
] as const satisfies readonly PreloadFeatureModule[];

export function composeBuiltinPreloadBridge(hostBridge: SetsunaDesktopBridge): DesktopPreloadBridge {
  const builder = createPreloadBridgeBuilder<DesktopPreloadBridge>(desktopPreloadBridgeKeys);
  builder.addHost(hostBridge);
  for (const feature of builtinPreloadFeatures) builder.addFeature(feature);
  return builder.build();
}
