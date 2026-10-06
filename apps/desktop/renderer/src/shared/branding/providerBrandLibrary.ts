import metadata from '../assets/provider-logos/lobehub-catalog.json';
import type { ProviderBrandAsset } from './providerBranding.js';

// Bundle inert image URLs; wordmarks and alternate brand layouts are not separate presets.
// Keeping SVGs external avoids embedding the whole library in the renderer's JavaScript.
const iconUrls = import.meta.glob<string>([
  '/node_modules/@lobehub/icons-static-svg/icons/*.svg',
  '!**/*-text*.svg',
  '!**/*-combine*.svg',
  '!**/*-brand*.svg',
], { eager: true, exhaustive: true, import: 'default', query: '?url&no-inline' });

export const LIBRARY_BRAND_CATALOG: readonly ProviderBrandAsset[] = metadata.brands.map((brand) => {
  const basePath = `/node_modules/@lobehub/icons-static-svg/icons/${brand.key}`;
  const monoSrc = iconUrls[`${basePath}.svg`];
  const colorSrc = iconUrls[`${basePath}-color.svg`];
  if (!monoSrc) throw new Error(`Missing bundled brand icon: ${brand.key}`);
  return { ...brand, src: colorSrc ?? monoSrc, monochrome: !colorSrc };
});

const libraryBrandsByKey = new Map(LIBRARY_BRAND_CATALOG.map((brand) => [brand.key, brand]));

export function libraryProviderBrand(key: string): ProviderBrandAsset | undefined {
  return libraryBrandsByKey.get(key);
}
