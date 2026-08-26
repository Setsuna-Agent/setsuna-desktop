// @vitest-environment happy-dom

import { BRAND_ICON_MAX_BYTES } from '@setsuna-desktop/contracts';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandIconPickerDialog } from '../../../../src/shared/branding/BrandIconPickerDialog.js';
import { brandIconFileError } from '../../../../src/shared/branding/brandIconUpload.js';
import { PROVIDER_BRAND_CATALOG } from '../../../../src/shared/branding/providerBranding.js';

describe('BrandIconPickerDialog', () => {
  it('keeps automatic matching, the visual preset catalog, and custom upload together', () => {
    const automaticBrand = PROVIDER_BRAND_CATALOG[0];
    if (!automaticBrand) throw new Error('Expected a built-in brand fixture');

    const providerDialog = render(
      <BrandIconPickerDialog
        automaticBrand={automaticBrand}
        icon={{ type: 'preset', key: 'qwen' }}
        name="Provider"
        subject="provider"
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const html = document.body.innerHTML;
    providerDialog.unmount();
    const modelDialog = render(
      <BrandIconPickerDialog
        automaticBrand={automaticBrand}
        name="gpt-5.6-sol"
        subject="model"
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const modelHtml = document.body.innerHTML;

    expect(html).toContain('sd-settings-dialog');
    expect(html).not.toContain('desktop-agent-modal');
    expect(html).toContain('settings-provider-icon-option__mark is-automatic');
    expect(html).toContain('settings-provider-icon-option is-selected');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(modelHtml).toContain('配置模型图标');
    expect(modelHtml).toContain('aria-label="模型图标"');
    modelDialog.unmount();
  });
});

describe('brandIconFileError', () => {
  it('accepts supported image files within the size limit', () => {
    expect(brandIconFileError({ name: 'logo.webp', type: 'image/webp', size: 2048 })).toBeNull();
  });

  it('rejects unsupported, empty and oversized files', () => {
    expect(brandIconFileError({ name: 'logo.svg', type: 'image/svg+xml', size: 1024 })).toContain('PNG');
    expect(brandIconFileError({ name: 'empty.png', type: 'image/png', size: 0 })).toContain('为空');
    expect(brandIconFileError({
      name: 'huge.png',
      type: 'image/png',
      size: BRAND_ICON_MAX_BYTES + 1,
    })).toContain('512 KB');
  });
});
