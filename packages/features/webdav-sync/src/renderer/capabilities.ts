import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { WebDavSyncDesktopBridge } from '../contracts/index.js';

export type WebDavSyncRendererHost = Readonly<{
  bridge: WebDavSyncDesktopBridge | null;
}>;

export const webDavSyncRendererHostCapability: CapabilityToken<WebDavSyncRendererHost> = defineCapability({
  id: 'webdav-sync.renderer-host',
  description: 'Desktop preload bridge used by the WebDAV sync settings view',
});
