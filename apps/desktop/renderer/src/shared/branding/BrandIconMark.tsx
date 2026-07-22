import type { ProviderBrandAsset } from './providerBranding.js';
import { useI18n } from '../i18n/I18nProvider.js';
import { localizedProviderBrandLabel, providerInitials } from './providerBranding.js';

type BrandIconMarkProps = {
  brand: ProviderBrandAsset | null;
  fallbackName: string;
  size?: 'compact' | 'default' | 'large';
};

export function BrandIconMark({ brand, fallbackName, size = 'default' }: BrandIconMarkProps) {
  const { t } = useI18n();
  const classes = [
    'brand-icon-mark',
    size === 'default' ? '' : `is-${size}`,
    brand?.monochrome ? 'is-monochrome' : '',
    brand ? '' : 'is-fallback',
  ].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      aria-hidden="true"
      title={brand ? localizedProviderBrandLabel(brand, t) : undefined}
    >
      {brand ? (
        <>
          <img alt="" className={brand.darkSrc ? 'is-light-variant' : undefined} draggable={false} src={brand.src} />
          {brand.darkSrc ? <img alt="" className="is-dark-variant" draggable={false} src={brand.darkSrc} /> : null}
        </>
      ) : <span>{providerInitials(fallbackName)}</span>}
    </span>
  );
}
