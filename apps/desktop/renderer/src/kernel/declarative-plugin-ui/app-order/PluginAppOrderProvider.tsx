import { createContext, useContext, type ReactNode } from 'react';
import { usePluginAppOrder } from './usePluginAppOrder.js';

const PluginAppOrderContext = createContext<ReturnType<typeof usePluginAppOrder> | null>(null);

export function PluginAppOrderProvider({ children }: { children: ReactNode }) {
  const order = usePluginAppOrder();
  return <PluginAppOrderContext.Provider value={order}>{children}</PluginAppOrderContext.Provider>;
}

export function usePluginAppOrderEntry(entryId: string) {
  const order = useContext(PluginAppOrderContext);
  return { dragging: order?.dragging ?? false, buttonProps: order?.buttonProps(entryId) };
}
