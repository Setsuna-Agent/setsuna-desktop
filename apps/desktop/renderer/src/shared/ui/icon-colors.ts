import { VIVID_PALETTE } from '@setsuna-desktop/renderer-ui';

export const ICON_PALETTE = VIVID_PALETTE;

export const ICON_COLORS = ['text', ...Object.values(ICON_PALETTE)] as const;

export type IconColor = typeof ICON_COLORS[number];

// Keep existing appearance preferences aligned when replacing the old muted palette.
const LEGACY_ICON_COLORS = new Map<string, IconColor>([
  ['#5688ed', ICON_PALETTE.blue],
  ['#31a183', ICON_PALETTE.green],
  ['#cf8a2c', ICON_PALETTE.yellow],
  ['#ba71d5', ICON_PALETTE.purple],
  ['#df7087', ICON_PALETTE.pink],
  ['#6f80d6', ICON_PALETTE.purple],
  ['#3ca1b3', ICON_PALETTE.blue],
  ['#d07760', ICON_PALETTE.orange],
]);

export function normalizeIconColor(value: unknown): IconColor | undefined {
  if (typeof value !== 'string') return undefined;
  return ICON_COLORS.find((color) => color === value) ?? LEGACY_ICON_COLORS.get(value);
}

/** Store a theme token so the original text color also adapts to dark mode. */
export function iconColorCssValue(color: string): string {
  const normalized = normalizeIconColor(color) ?? color;
  return normalized === 'text' ? 'var(--app-text)' : normalized;
}
