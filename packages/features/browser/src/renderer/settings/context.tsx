import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/bridge.js';

export const browserRendererHostCapability = defineCapability<Readonly<{ bridge: BrowserDesktopBridge | null }>>({
  id: 'browser.renderer-host', description: 'Native browser settings and management bridge',
});

type BrowserSettingsNavigation = {
  openSettings(section: string, path?: readonly string[]): void;
  openPage(url: string): void;
};
const NavigationContext = createContext<(BrowserSettingsNavigation & {
  openExtensionSettings(): void;
}) | null>(null);
export function BrowserSettingsNavigationProvider({ children, value }: { children: ReactNode; value: BrowserSettingsNavigation }) {
  const openExtensionSettings = useCallback(() => {
    value.openSettings('browser', ['extensions']);
  }, [value.openSettings]);
  const navigation = useMemo(() => ({ ...value, openExtensionSettings }), [value, openExtensionSettings]);
  return <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>;
}
export function useBrowserSettingsNavigation() { return useContext(NavigationContext); }
