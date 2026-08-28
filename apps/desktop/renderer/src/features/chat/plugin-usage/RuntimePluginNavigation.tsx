import { createContext, useContext, type ReactNode } from 'react';

export type OpenRuntimePluginHandler = (pluginId: string) => void;

const RuntimePluginNavigationContext = createContext<OpenRuntimePluginHandler | null>(null);

export function RuntimePluginNavigationProvider({
  children,
  onOpenPlugin,
}: Readonly<{
  children: ReactNode;
  onOpenPlugin: OpenRuntimePluginHandler;
}>) {
  return (
    <RuntimePluginNavigationContext.Provider value={onOpenPlugin}>
      {children}
    </RuntimePluginNavigationContext.Provider>
  );
}

export function useRuntimePluginNavigation(): OpenRuntimePluginHandler | null {
  return useContext(RuntimePluginNavigationContext);
}
