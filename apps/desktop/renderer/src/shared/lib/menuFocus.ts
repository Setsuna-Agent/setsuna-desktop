export type MenuFocusIntent = 'first' | 'last' | 'next' | 'previous';

export function menuFocusIntent(key: string): MenuFocusIntent | null {
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'previous';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  return null;
}

export function nextMenuItemIndex(
  itemCount: number,
  currentIndex: number,
  intent: MenuFocusIntent,
): number {
  if (itemCount <= 0) return -1;
  if (intent === 'first') return 0;
  if (intent === 'last') return itemCount - 1;
  if (intent === 'next') return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
  return currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount;
}

export function focusMenuItem(menu: HTMLElement | null, intent: MenuFocusIntent): void {
  if (!menu) return;
  const items = Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  ).filter((item) => item.getAttribute('aria-disabled') !== 'true');
  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  const nextIndex = nextMenuItemIndex(items.length, currentIndex, intent);
  items[nextIndex]?.focus();
}
