import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { NetworkProxyDesktopBridge } from '../contracts/index.js';
import type { NetworkProxyRendererStateService } from './service.js';

export type NetworkProxyRendererHost = Readonly<{
  bridge: NetworkProxyDesktopBridge | null;
}>;

export const networkProxyRendererHostCapability: CapabilityToken<NetworkProxyRendererHost> = defineCapability({
  id: 'network-proxy.renderer-host',
  description: 'Desktop preload bridge used by network proxy settings',
});

export const networkProxyRendererStateCapability: CapabilityToken<NetworkProxyRendererStateService> = defineCapability({
  id: 'network-proxy.renderer-state',
  description: 'Single renderer owner for network proxy state and actions',
});
