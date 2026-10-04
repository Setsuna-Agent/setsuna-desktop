import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { BrowserWindow } from 'electron';
import type { BrowserControlConnection } from '../contracts/index.js';
import type { BrowserPasswordStorage } from './passwords/store.js';

export interface BrowserMainHost {
  extensionPreloadPath: string;
  passwordStorage: BrowserPasswordStorage;
  focusedWindow(): BrowserWindow | null;
  onWindowAdded(listener: (window: BrowserWindow) => () => void): () => void;
  activeKeyboardShortcutBindings(senderId: number): ReadonlySet<string>;
  interfaceLanguage(): RuntimeInterfaceLanguage;
}

export const browserMainHostCapability: CapabilityToken<BrowserMainHost> = defineCapability({
  id: 'browser.main-host',
  description: 'Desktop window state required by the embedded browser native boundary',
});

export const browserControlConnectionCapability: CapabilityToken<BrowserControlConnection> = defineCapability({
  id: 'browser.control-connection',
  description: 'Authenticated loopback connection exposed to the desktop runtime',
});
