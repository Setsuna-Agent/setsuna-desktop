import type { ProviderConfigState, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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

  it('renders all six task-model selectors with configured choices', () => {
    const html = renderToStaticMarkup(
      <TaskModelSettings config={configFixture} onSave={async () => undefined} />,
    );

    expect(html.match(/task-model-settings__select/gu)).toHaveLength(6);
    expect(html.match(/task-model-settings__card/gu)).toHaveLength(3);
    for (const groupLabel of ['对话辅助', '审查与安全', '记忆与上下文']) {
      expect(html).toContain(`>${groupLabel}</h3>`);
    }
    expect(html).not.toContain('专用任务模型');
    for (const label of ['标题生成', '代码审查', '审批审查', '记忆提取', '记忆整理', '上下文压缩']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('MiniMax · MiniMax M3 (MiniMax-M3)');
    expect(html).toContain('火山方舟 · Kimi K2.7 (kimi-k2.7)');
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
    disableOnExternalContext: false,
  },
  memoryEnabled: true,
  taskModels: {
    threadTitle: {
      providerId: 'provider-kimi',
      modelId: 'kimi-k2',
    },
    review: {
      providerId: 'provider-kimi',
      modelId: 'kimi-k2',
    },
    approvalReview: {
      providerId: 'provider-kimi',
      modelId: 'kimi-k2',
    },
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
