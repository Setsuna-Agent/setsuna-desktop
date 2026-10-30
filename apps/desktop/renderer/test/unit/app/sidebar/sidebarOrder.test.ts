import { describe, expect, it } from 'vitest';
import { moveSidebarItem, orderSidebarItems, parseSidebarOrders } from '../../../../src/app/sidebar/sidebarOrder.js';

describe('sidebar order preferences', () => {
  it('keeps new chats first and retains temporarily absent chats through a move and restoration', () => {
    const saved = ['a', 'pinned', 'b', 'archived', 'c'];
    const items = ['new', 'a', 'b', 'c', 'not-yet-loaded'].map((id) => ({ id }));
    const available = items.slice(0, 4);
    const order = orderSidebarItems(available, saved).map((item) => item.id);
    expect(order).toEqual(['new', 'a', 'b', 'c']);
    const moved = moveSidebarItem(saved, order, 'c', 'a', 'before')!;
    expect(moved).toEqual(['new', 'c', 'pinned', 'a', 'archived', 'b']);
    const restored = [...items, { id: 'pinned' }, { id: 'archived' }];
    expect(orderSidebarItems(restored, moved).map((item) => item.id))
      .toEqual(['not-yet-loaded', 'new', 'c', 'pinned', 'a', 'archived', 'b']);
    expect(saved).toEqual(['a', 'pinned', 'b', 'archived', 'c']);
  });

  it('moves across the full group without losing chats hidden behind show more and rejects foreign identities', () => {
    const ids = ['1', '2', '3', '4', '5', '6'];
    expect(moveSidebarItem([], ids, '1', '5', 'after')).toEqual(['2', '3', '4', '5', '1', '6']);
    expect(moveSidebarItem(ids, ids, 'foreign', '1', 'before')).toBeNull();
    expect(moveSidebarItem(ids, ids, '1', 'foreign', 'before')).toBeNull();
    expect(moveSidebarItem(ids, ids, '1', '2', 'before')).toBeNull();
  });

  it('recovers malformed preferences without inventing or duplicating saved identities', () => {
    expect(parseSidebarOrders('{')).toEqual({});
    expect(parseSidebarOrders('[]')).toEqual({});
    expect(parseSidebarOrders(JSON.stringify({ projects: ['a', null, 'a', '', 1, 'b'], invalid: 'c' })))
      .toEqual({ projects: ['a', 'b'] });
  });
});
