import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandIconDialog } from '../../../../src/features/settings/BrandIconDialog.js';
import { PROVIDER_BRAND_CATALOG } from '../../../../src/shared/branding/providerBranding.js';

describe('BrandIconDialog', () => {
  it('renders automatic, saved-preset, and custom-upload choices together', () => {
    const automaticBrand = PROVIDER_BRAND_CATALOG[0];
    if (!automaticBrand) throw new Error('Expected a built-in brand fixture');

    const html = renderToStaticMarkup(
      <BrandIconDialog
        automaticBrand={automaticBrand}
        icon={{ type: 'preset', key: 'qwen' }}
        name="Provider"
        subject="provider"
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(html).toContain('settings-provider-icon-option__mark is-automatic');
    expect(html).toContain('settings-provider-icon-option is-selected');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
  });
});
