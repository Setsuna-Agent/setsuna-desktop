import { createContext, useContext } from 'react';

export type SettingsPageNavigation = Readonly<{
  path: readonly string[];
  navigate(path: readonly string[]): void;
}>;

const SettingsPageNavigationContext = createContext<SettingsPageNavigation | null>(null);

/** The host records destinations; Features interpret their own section's path. */
export const SettingsPageNavigationProvider = SettingsPageNavigationContext.Provider;

export function useSettingsPageNavigation(): SettingsPageNavigation {
  const navigation = useContext(SettingsPageNavigationContext);
  if (!navigation) throw new Error('Settings navigation requires SettingsPageNavigationProvider.');
  return navigation;
}
