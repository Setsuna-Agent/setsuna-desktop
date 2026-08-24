import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { BrowserWindow } from 'electron';

export interface UpdaterMainHost {
  readonly currentVersion: string;
  readonly downloadsDir: string;
  readonly enabled: boolean;
  readonly mainWindow: BrowserWindow;
  readonly repository: string;
  readonly sourceConfigPath: string;
  fetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response>;
  interfaceLanguage(): RuntimeInterfaceLanguage;
}

export interface UpdaterLifecycle {
  initialize(): Promise<void>;
  start(): void;
  stop(): void;
}

export const updaterMainHostCapability: CapabilityToken<UpdaterMainHost> = defineCapability({
  id: 'updater.main-host',
  description: 'Desktop paths, network access, window, and release identity required by updates',
});

export const updaterLifecycleCapability: CapabilityToken<UpdaterLifecycle> = defineCapability({
  id: 'updater.lifecycle',
  description: 'Host-controlled initialization, first-paint start, and early stop for desktop updates',
});
