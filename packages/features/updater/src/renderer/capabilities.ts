import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { UpdaterDesktopBridge } from '../contracts/index.js';
import type { UpdaterRendererStateService } from './service.js';

export type UpdaterRendererHost = Readonly<{
  bridge: UpdaterDesktopBridge | null;
  platform: string;
  openExternal(url: string): Promise<boolean>;
}>;

export const updaterRendererHostCapability: CapabilityToken<UpdaterRendererHost> = defineCapability({
  id: 'updater.renderer-host',
  description: 'Desktop preload bridge and shell actions used by updater presentation',
});

export const updaterRendererStateCapability: CapabilityToken<UpdaterRendererStateService> = defineCapability({
  id: 'updater.renderer-state',
  description: 'Single renderer owner for desktop update state and actions',
});
