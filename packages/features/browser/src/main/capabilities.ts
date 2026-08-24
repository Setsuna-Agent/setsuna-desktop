import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { BrowserWindow } from 'electron';
import type { BrowserControlConnection } from '../contracts/index.js';

export interface BrowserMainHost {
  readonly mainWindow: BrowserWindow;
  activeKeyboardShortcutBindings(): ReadonlySet<string>;
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
