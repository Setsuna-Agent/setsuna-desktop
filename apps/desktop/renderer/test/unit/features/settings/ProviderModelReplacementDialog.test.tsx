import type { ProviderModelConfig } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProviderModelReplacementDialog } from '../../../../src/features/settings/ProviderModelReplacementDialog.js';

describe('ProviderModelReplacementDialog', () => {
  it('shows the current and replacement lists with a destructive confirmation', () => {
    const html = renderToStaticMarkup(createElement(ProviderModelReplacementDialog, {
      providerName: 'Kimi',
      currentModels: [model('old-model'), model('shared-model')],
      nextModels: [model('shared-model'), model('new-model')],
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    }));

    expect(html).toContain('替换“Kimi”的模型列表？');
    expect(html).toContain('当前配置');
    expect(html).toContain('替换后');
    expect(html).toContain('old-model');
    expect(html).toContain('new-model');
    expect(html).toContain('输出 8192');
    expect(html).toContain('新增 1');
    expect(html).toContain('移除 1');
    expect(html).toContain('确认替换');
    expect(html).toContain('保留当前配置');
  });
});

function model(code: string): ProviderModelConfig {
  return {
    id: code,
    name: code,
    code,
    enabled: code === 'shared-model',
    maxOutputTokens: 8192,
    thinkingEnabled: false,
    thinkingEfforts: [],
    supportsImages: false,
  };
}
