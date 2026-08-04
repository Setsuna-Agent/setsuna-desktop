import { describe, expect, it } from 'vitest';
import { menuFocusIntent, nextMenuItemIndex } from '../../../../src/shared/lib/menuFocus.js';

describe('menu focus navigation', () => {
  it('maps standard menu navigation keys', () => {
    expect(menuFocusIntent('ArrowDown')).toBe('next');
    expect(menuFocusIntent('ArrowUp')).toBe('previous');
    expect(menuFocusIntent('Home')).toBe('first');
    expect(menuFocusIntent('End')).toBe('last');
    expect(menuFocusIntent('Tab')).toBeNull();
  });

  it('wraps focus through enabled menu items', () => {
    expect(nextMenuItemIndex(3, -1, 'next')).toBe(0);
    expect(nextMenuItemIndex(3, 2, 'next')).toBe(0);
    expect(nextMenuItemIndex(3, 0, 'previous')).toBe(2);
    expect(nextMenuItemIndex(3, 1, 'first')).toBe(0);
    expect(nextMenuItemIndex(3, 1, 'last')).toBe(2);
  });
});
