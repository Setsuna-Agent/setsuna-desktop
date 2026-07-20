import type { ProviderBrandAsset } from './providerBranding.js';
import { providerInitials } from './providerBranding.js';

type BrandIconMarkProps = {
  brand: ProviderBrandAsset | null;
  fallbackName: string;
  size?: 'compact' | 'default' | 'large';
};

export function BrandIconMark({ brand, fallbackName, size = 'default' }: BrandIconMarkProps) {
  const classes = [
    'brand-icon-mark',
    size === 'default' ? '' : `is-${size}`,
    brand?.monochrome ? 'is-monochrome' : '',
    brand ? '' : 'is-fallback',
  ].filter(Boolean).join(' ');

  return (
    <span className={classes} aria-hidden="true" title={brand?.label}>
      {brand ? (
        <>
          <img alt="" className={brand.darkSrc ? 'is-light-variant' : undefined} draggable={false} src={brand.src} />
          {brand.darkSrc ? <img alt="" className="is-dark-variant" draggable={false} src={brand.darkSrc} /> : null}
        </>
      ) : <span>{providerInitials(fallbackName)}</span>}
    </span>
  );
}
