import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatModelPicker } from '../../../../../src/features/chat/composer/ChatModelPicker.js';

vi.mock('../../../../../src/features/chat/composer/useActiveOptionScroll.js', () => ({
  useActiveOptionScroll: () => ({
    activeOptionRef: { current: null },
    scrollContainerRef: { current: null },
  }),
}));

describe('ChatModelPicker', () => {
  it('shows the resolved active model icon instead of the generic model mark', () => {
    const html = renderToStaticMarkup(
      <ChatModelPicker
        config={config}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('brand-icon-mark is-compact');
    expect(html).toContain('title="智谱 GLM"');
    expect(html).not.toContain('chat-model-selector__placeholder-icon');
  });
});

const config: RuntimeConfigState = {
  configPath: '/tmp/config.json',
  dataPath: '/tmp/setsuna',
  storagePath: '',
  activeProviderId: 'bailian',
  providers: [{
    id: 'bailian',
    name: 'bailian',
    provider: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    enabled: true,
    apiKeySet: true,
    apiKeyPreview: '***',
    models: [{
      id: 'glm-5-2',
      name: 'glm-5-2',
      code: 'glm-5-2',
      enabled: true,
      maxOutputTokens: 8192,
      thinkingEnabled: false,
      thinkingEfforts: [],
    }],
  }],
  globalPrompt: '',
  memory: {
    useMemories: false,
    generateMemories: false,
    dedicatedTools: false,
    disableOnExternalContext: true,
  },
  memoryEnabled: false,
  setsunaStyle: 'developer',
  approvalPolicy: 'on-request',
  permissionProfile: 'workspace-write',
};
