import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { ChatDisplayItem } from '../conversation/chatMessageDisplay.js';

export type ChatMessageSelectionMode = 'delete' | 'export';

export function useChatMessageSelection(displayItems: ChatDisplayItem[]) {
  const [mode, setMode] = useState<ChatMessageSelectionMode | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const items = useMemo(() => displayItems.flatMap((item) => {
    if (item.type !== 'user' && item.type !== 'assistant') return [];
    // The last segment survives loading earlier pages of the same completed reply.
    const key = item.type === 'user' ? item.message.id : item.segments.at(-1)?.id;
    return key ? [{ id: item.id, key, type: item.type, messageIds: item.messageIds }] : [];
  }), [displayItems]);
  const selectedItems = useMemo(() => items.filter((item) => selectedKeys.has(item.key)), [items, selectedKeys]);
  const selectedItemIds = useMemo(() => new Set(selectedItems.map((item) => item.id)), [selectedItems]);
  const messageIds = useMemo(() => [...new Set(selectedItems.flatMap((item) => mode === 'export' ? [item.key] : item.messageIds))], [mode, selectedItems]);

  useLayoutEffect(() => {
    const validKeys = new Set(items.map((item) => item.key));
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const groupKeys = useCallback((itemId: string, operation: ChatMessageSelectionMode) => {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) return [];
    const item = items[index];
    const keys = [item.key];
    if (operation === 'export') return keys;
    // Deletion keeps question/answer pairs together; export selects each bubble independently.
    const partner = item.type === 'assistant'
      ? items.slice(0, index).reverse().find((candidate) => candidate.type === 'user')
      : items[index + 1]?.type === 'assistant' ? items[index + 1] : undefined;
    if (partner) keys.push(partner.key);
    return keys;
  }, [items]);
  const start = useCallback((itemId: string, operation: ChatMessageSelectionMode) => {
    setMode(operation);
    setSelectedKeys(new Set(groupKeys(itemId, operation)));
  }, [groupKeys]);
  const toggle = useCallback((itemId: string, checked: boolean) => {
    if (!mode) return;
    const keys = groupKeys(itemId, mode);
    setSelectedKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => { if (checked) next.add(key); else next.delete(key); });
      return next;
    });
  }, [groupKeys, mode]);
  const toggleAll = useCallback((checked: boolean) => {
    setSelectedKeys(new Set(checked ? items.map((item) => item.key) : []));
  }, [items]);
  const clear = useCallback(() => {
    setMode(null);
    setSelectedKeys(new Set());
  }, []);

  return {
    mode, selectedItemIds, messageIds, selectedCount: selectedItems.length, totalCount: items.length,
    allChecked: items.length > 0 && selectedItems.length === items.length,
    indeterminate: selectedItems.length > 0 && selectedItems.length < items.length,
    start, toggle, toggleAll, clear,
  };
}
