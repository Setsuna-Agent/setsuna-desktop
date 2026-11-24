import { createContext, useContext, type ReactNode } from 'react';
import { usePluginAppOrder } from './usePluginAppOrder.js';

const PluginAppOrderContext = createContext<ReturnType<typeof usePluginAppOrder> | null>(null);

export function PluginAppOrderProvider({ children, hiddenEntryIds }: { children: ReactNode; hiddenEntryIds?: ReadonlySet<string> }) {
  const order = usePluginAppOrder(hiddenEntryIds);
  return <PluginAppOrderContext.Provider value={order}>
    <div className="app-navigation__app-order" ref={order.rootRef}>{children}</div>
  </PluginAppOrderContext.Provider>;
}

export function usePluginAppOrderEntry(entryId: string) {
  const order = useContext(PluginAppOrderContext);
  return { dragging: order?.dragging ?? false, buttonProps: order?.buttonProps(entryId) };
}
