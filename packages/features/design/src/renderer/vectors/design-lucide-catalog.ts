import { createElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { designDefaultColor } from '../../contracts/design-color.js';
import type { DesignLucideSource } from './design-svg-source.js';

export type LucideIconLoader = () => Promise<{ default: LucideIcon }>;

export async function loadDesignLucideCatalog(): Promise<Readonly<Record<string, LucideIconLoader>>> {
  const { default: icons } = await import('lucide-react/dynamicIconImports.js');
  // The installed version's declarations also admit a CommonJS default wrapper.
  return (icons.default ?? icons) as Record<string, LucideIconLoader>;
}

export async function readDesignLucideSource(name: string): Promise<DesignLucideSource | undefined> {
  const catalog = await loadDesignLucideCatalog();
  if (!Object.hasOwn(catalog, name)) return;
  const [{ default: Icon }, { renderToStaticMarkup }] = await Promise.all([catalog[name](), import('react-dom/server')]);
  return { name, icon: name, color: designDefaultColor, markup: renderToStaticMarkup(createElement(Icon)) };
}
