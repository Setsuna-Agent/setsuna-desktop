import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '../providers/ToastProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { readBrowserStorageValue, writeBrowserStorageValue } from '../../shared/preferences/browserStorage.js';
import { moveSidebarItem, orderSidebarItems, parseSidebarOrders, SIDEBAR_ORDER_STORAGE_KEY,
  type SidebarDropPosition, type SidebarOrders } from './sidebarOrder.js';

const EMPTY_ORDER: readonly string[] = [];
const SidebarOrderContext = createContext<{
  orders: SidebarOrders;
  move(scope: string, ids: readonly string[], sourceId: string, targetId: string, position: SidebarDropPosition): void;
} | null>(null);

function readOrders() { return parseSidebarOrders(readBrowserStorageValue(SIDEBAR_ORDER_STORAGE_KEY)); }

export function SidebarOrderProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState(readOrders);
  const { t } = useI18n();
  const toast = useToast();
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === SIDEBAR_ORDER_STORAGE_KEY || event.key === null) setOrders(readOrders());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const move = useCallback((scope: string, ids: readonly string[], sourceId: string, targetId: string, position: SidebarDropPosition) => {
    const current = readOrders();
    // A concurrent change to this group invalidates the drop; unrelated groups are merged below.
    if (JSON.stringify(current[scope] ?? []) !== JSON.stringify(orders[scope] ?? [])) {
      setOrders(current);
      return;
    }
    const nextOrder = moveSidebarItem(current[scope] ?? [], ids, sourceId, targetId, position);
    if (!nextOrder) return;
    const next = { ...current, [scope]: nextOrder };
    if (!writeBrowserStorageValue(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(next))) {
      toast.error(t('sidebar.orderSaveFailed'));
      return;
    }
    setOrders(next);
  }, [orders, t, toast]);
  const value = useMemo(() => ({ orders, move }), [orders, move]);
  return <SidebarOrderContext.Provider value={value}>{children}</SidebarOrderContext.Provider>;
}

export function useSidebarOrder<T extends { id: string }>(scope: string, items: readonly T[]) {
  const context = useContext(SidebarOrderContext);
  const saved = context?.orders[scope] ?? EMPTY_ORDER;
  const ordered = useMemo(() => orderSidebarItems(items, saved), [items, saved]);
  return {
    items: ordered,
    move: (sourceId: string, targetId: string, position: SidebarDropPosition) => {
      context?.move(scope, ordered.map((item) => item.id), sourceId, targetId, position);
    },
  };
}
