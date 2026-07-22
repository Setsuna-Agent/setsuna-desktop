import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BrandIconDialog } from '../../../../src/features/settings/BrandIconDialog.js';
import {
  PROVIDER_BRAND_CATALOG,
  resolveAutomaticProviderBrand,
} from '../../../../src/shared/branding/providerBranding.js';

describe('BrandIconDialog', () => {
  it('renders automatic matching, every preset and custom upload controls', () => {
    const html = renderDialog(providerFixture);

    expect(html).toContain('配置服务图标');
    expect(html).toContain('自动匹配');
    expect(html).toContain('自定义上传');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    for (const brand of PROVIDER_BRAND_CATALOG) expect(html).toContain(brand.label);
  });

  it('marks a saved preset as selected', () => {
    const html = renderDialog({ ...providerFixture, icon: { type: 'preset', key: 'qwen' } });
    expect(html).toContain('settings-provider-icon-option is-selected');
    expect(html).toContain('aria-checked="true"');
  });

  it('adapts its copy for a model icon', () => {
    const html = renderToStaticMarkup(
      <BrandIconDialog
        automaticBrand={resolveAutomaticProviderBrand(providerFixture)}
        name="gpt-5.6-sol"
        subject="model"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(html).toContain('配置模型图标');
    expect(html).toContain('aria-label="模型图标"');
  });
});

function renderDialog(provider: ProviderConfigState): string {
  return renderToStaticMarkup(
    <BrandIconDialog
      automaticBrand={resolveAutomaticProviderBrand(provider)}
      icon={provider.icon}
      name={provider.name}
      subject="provider"
      onClose={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

const providerFixture: ProviderConfigState = {
  id: 'provider-minimax',
  name: 'MiniMax',
  provider: 'openai-compatible',
  baseUrl: 'https://api.minimaxi.com/v1',
  enabled: true,
  apiKeySet: false,
  apiKeyPreview: '',
  models: [],
};
