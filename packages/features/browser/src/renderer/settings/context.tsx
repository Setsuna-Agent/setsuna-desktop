import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/bridge.js';

export const browserRendererHostCapability = defineCapability<Readonly<{ bridge: BrowserDesktopBridge | null }>>({
  id: 'browser.renderer-host', description: 'Native browser settings and management bridge',
});

type BrowserSettingsNavigation = { openSettings(section: string): void; openPage(url: string): void };
const NavigationContext = createContext<(BrowserSettingsNavigation & {
  extensionsRequested: boolean;
  openExtensionSettings(): void;
  consumeExtensionsRequest(): void;
}) | null>(null);
export function BrowserSettingsNavigationProvider({ children, value }: { children: ReactNode; value: BrowserSettingsNavigation }) {
  const [extensionsRequested, setExtensionsRequested] = useState(false);
  const openExtensionSettings = useCallback(() => {
    setExtensionsRequested(true);
    value.openSettings('browser');
  }, [value.openSettings]);
  const consumeExtensionsRequest = useCallback(() => setExtensionsRequested(false), []);
  const navigation = useMemo(() => ({ ...value, extensionsRequested, openExtensionSettings, consumeExtensionsRequest }),
    [value, extensionsRequested, openExtensionSettings, consumeExtensionsRequest]);
  return <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>;
}
export function useBrowserSettingsNavigation() { return useContext(NavigationContext); }
