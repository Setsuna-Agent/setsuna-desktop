import type { ProviderConfigState, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  configuredTaskModelOptions,
} from '../../../../src/features/settings/sections/task-model-options.js';
import { TaskModelSettings } from '../../../../src/features/settings/sections/TaskModelSettings.js';

describe('TaskModelSettings', () => {
  it('offers configured models from every enabled provider', () => {
    const options = configuredTaskModelOptions(configFixture);

    expect(options.map((option) => option.reference)).toEqual([
      { providerId: 'provider-minimax', modelId: 'minimax-m3' },
      { providerId: 'provider-kimi', modelId: 'kimi-k2' },
    ]);
    expect(options.map((option) => option.label)).toEqual([
      'MiniMax · MiniMax M3 (MiniMax-M3)',
      '火山方舟 · Kimi K2.7 (kimi-k2.7)',
    ]);
  });

  it('renders every host-owned task-model selector with configured choices', () => {
    const html = renderToStaticMarkup(
      <TaskModelSettings config={configFixture} onSave={async () => undefined} />,
    );

    expect(html.match(/\bsd-settings-row\b/gu)).toHaveLength(1);
    expect(html.match(/\bsd-select-field\b/gu)).toHaveLength(1);
    expect(html.match(/task-model-settings__card/gu)).toHaveLength(1);
    expect(html).not.toContain('task-model-option-label');
    expect(html).toContain('>上下文</h3>');
    expect(html).not.toContain('专用任务模型');
    expect(html).toContain('aria-label="上下文压缩"');
    expect(html).toContain('接近上下文上限时，把较早的对话整理成可继续使用的摘要。');
    expect(html).toContain('MiniMax · MiniMax M3 (MiniMax-M3)');
  });

});

const enabledProviders: ProviderConfigState[] = [
  {
    id: 'provider-minimax',
    name: 'MiniMax',
    provider: 'openai-compatible',
    baseUrl: 'https://api.minimaxi.com/v1',
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: '***',
    models: [{
      id: 'minimax-m3',
      name: 'MiniMax M3',
      code: 'MiniMax-M3',
      enabled: true,
      icon: { type: 'preset', key: 'minimax' },
      maxOutputTokens: 8_192,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  },
  {
    id: 'provider-kimi',
    name: '火山方舟',
    provider: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: '***',
    models: [{
      id: 'kimi-k2',
      name: 'Kimi K2.7',
      code: 'kimi-k2.7',
      enabled: true,
      maxOutputTokens: 8_192,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  },
];

const configFixture: RuntimeConfigState = {
  configPath: '/tmp/config.json',
  dataPath: '/tmp/runtime',
  storagePath: '/tmp/runtime/memories',
  activeProviderId: 'provider-minimax',
  providers: [
    ...enabledProviders,
    {
      ...enabledProviders[0],
      id: 'provider-disabled',
      name: 'Disabled provider',
      enabled: false,
    },
  ],
  globalPrompt: '',
  taskModels: {
    contextCompaction: {
      providerId: 'provider-minimax',
      modelId: 'minimax-m3',
    },
  },
  setsunaStyle: 'developer',
  approvalPolicy: 'on-request',
  permissionProfile: 'workspace-write',
};
