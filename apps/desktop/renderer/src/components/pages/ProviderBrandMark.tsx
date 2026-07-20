import type { ProviderBrandAsset } from './providerBranding.js';
import { providerInitials } from './providerBranding.js';

type ProviderBrandMarkProps = {
  brand: ProviderBrandAsset | null;
  fallbackName: string;
  size?: 'default' | 'large';
};

export function ProviderBrandMark({ brand, fallbackName, size = 'default' }: ProviderBrandMarkProps) {
  const classes = [
    'chat-user-settings__provider-brand-mark',
    size === 'large' ? 'is-large' : '',
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
