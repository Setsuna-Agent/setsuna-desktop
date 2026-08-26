import type { BrandIconConfig } from '@setsuna-desktop/contracts';

export function withBrandIcon<T extends object>(value: T, icon: BrandIconConfig | undefined): T {
  const next = { ...value, ...(icon ? { icon } : {}) } as T & { icon?: BrandIconConfig };
  if (!icon) delete next.icon;
  return next;
}
