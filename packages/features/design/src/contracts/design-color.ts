export const designDefaultColor = '#000000';

export function parseDesignColor(value: unknown): string {
  if (typeof value === 'string' && /^#[a-f\d]{6}(?:[a-f\d]{2})?$/iu.test(value)) return value;
  throw new Error('Invalid design color.');
}

export function splitDesignColor(value: string): { color: string; opacity: number } {
  return { color: value.slice(0, 7), opacity: value.length === 9 ? Number.parseInt(value.slice(7), 16) / 255 : 1 };
}

export function designColorWithAlpha(value: string, opacity: number): string {
  const color = value.slice(0, 7);
  const alpha = Math.round(opacity * 255);
  return alpha === 255 ? color : `${color}${alpha.toString(16).padStart(2, '0')}`;
}
