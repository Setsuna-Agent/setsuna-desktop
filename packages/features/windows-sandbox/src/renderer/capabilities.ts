import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { WindowsSandboxDesktopBridge } from '../contracts/index.js';

export interface WindowsSandboxRendererHost {
  readonly bridge: WindowsSandboxDesktopBridge | null;
  readonly platform: string;
}

export const windowsSandboxRendererHostCapability: CapabilityToken<WindowsSandboxRendererHost> = defineCapability({
  id: 'windows-sandbox.renderer-host',
  description: 'Desktop bridge and platform exposed to the Windows sandbox settings contribution',
});
