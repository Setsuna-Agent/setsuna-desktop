import type { ProviderConfigState, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  configuredTaskModelOptions,
} from '../../../../src/features/settings/providers/provider-model.js';
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

  it('renders selected model branding in every model selector', () => {
    const html = renderToStaticMarkup(
      <TaskModelSettings config={configFixture} onSave={vi.fn()} />,
    );

    expect(html).toContain('记忆提取');
    expect(html).toContain('记忆整理');
    expect(html).toContain('上下文压缩');
    expect(html).toContain('MiniMax · MiniMax M3 (MiniMax-M3)');
    expect(html).toContain('火山方舟 · Kimi K2.7 (kimi-k2.7)');
    expect(html).toContain('brand-icon-mark is-compact');
    expect(html).not.toContain('Disabled provider ·');
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
  memory: {
    useMemories: true,
    generateMemories: true,
    dedicatedTools: false,
    disableOnExternalContext: false,
  },
  memoryEnabled: true,
  taskModels: {
    memoryExtraction: {
      providerId: 'provider-minimax',
      modelId: 'minimax-m3',
    },
    memoryConsolidation: {
      providerId: 'provider-kimi',
      modelId: 'kimi-k2',
    },
    contextCompaction: {
      providerId: 'provider-minimax',
      modelId: 'minimax-m3',
    },
  },
  setsunaStyle: 'developer',
  approvalPolicy: 'on-request',
  permissionProfile: 'workspace-write',
};
