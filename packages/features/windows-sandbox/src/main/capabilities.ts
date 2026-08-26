import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { DesktopSandboxNetworkEnvironment } from '../contracts/index.js';

export interface WindowsSandboxMainHost {
  readonly executablePath?: string;
  isRendererSender(senderId: number): boolean;
  resolveUpstreamProxy(): Promise<string | undefined>;
}

export interface WindowsSandboxMainService {
  resolveNetworkEnvironment(): Promise<DesktopSandboxNetworkEnvironment>;
}

export const windowsSandboxMainHostCapability: CapabilityToken<WindowsSandboxMainHost> = defineCapability({
  id: 'windows-sandbox.main-host',
  description: 'Desktop sidecar path, renderer identity, and routed network state for the Windows sandbox',
});

export const windowsSandboxMainServiceCapability: CapabilityToken<WindowsSandboxMainService> = defineCapability({
  id: 'windows-sandbox.main-service',
  description: 'Authenticated network environment for native Windows sandbox commands',
});
