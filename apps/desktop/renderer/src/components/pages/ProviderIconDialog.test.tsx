import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { ProviderIconDialog } from './ProviderIconDialog.js';
import { PROVIDER_BRAND_CATALOG } from './providerBranding.js';

describe('ProviderIconDialog', () => {
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
});

function renderDialog(provider: ProviderConfigState): string {
  return renderToStaticMarkup(
    <ProviderIconDialog provider={provider} onClose={vi.fn()} onConfirm={vi.fn()} />,
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
