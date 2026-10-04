import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import { createContext, useContext, type ReactNode } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/bridge.js';

export const browserRendererHostCapability = defineCapability<Readonly<{ bridge: BrowserDesktopBridge | null }>>({
  id: 'browser.renderer-host', description: 'Native browser settings and management bridge',
});

type BrowserSettingsNavigation = { openSettings(section: string): void; openPage(url: string): void };
const NavigationContext = createContext<BrowserSettingsNavigation | null>(null);
export function BrowserSettingsNavigationProvider({ children, value }: { children: ReactNode; value: BrowserSettingsNavigation }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
export function useBrowserSettingsNavigation() { return useContext(NavigationContext); }
