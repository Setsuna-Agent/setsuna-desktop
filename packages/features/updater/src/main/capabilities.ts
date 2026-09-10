import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export interface UpdaterMainHost {
  readonly currentVersion: string;
  readonly downloadsDir: string;
  readonly enabled: boolean;
  readonly repository: string;
  readonly sourceConfigPath: string;
  fetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response>;
}

export interface UpdaterLifecycle {
  initialize(): Promise<void>;
  start(): void;
  stop(): void;
}

export const updaterMainHostCapability: CapabilityToken<UpdaterMainHost> = defineCapability({
  id: 'updater.main-host',
  description: 'Desktop paths, network access and release identity required by updates',
});

export const updaterLifecycleCapability: CapabilityToken<UpdaterLifecycle> = defineCapability({
  id: 'updater.lifecycle',
  description: 'Host-controlled initialization, first-paint start, and early stop for desktop updates',
});
