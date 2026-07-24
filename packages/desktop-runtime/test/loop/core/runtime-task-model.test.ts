import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { runtimeTaskModelRequest } from '../../../src/loop/core/runtime-task-model.js';

describe('runtime task model selection', () => {
  it('resolves a task to its configured provider and model', () => {
    const config = taskModelConfig();

    expect(runtimeTaskModelRequest(
      config,
      'memoryExtraction',
      'passive-memory-extraction',
    )).toEqual({
      model: 'background-model-code',
      providerId: 'background-provider',
    });
  });

  it('falls back safely when an assignment no longer points to an enabled configured model', () => {
    const config = taskModelConfig();
    config.providers[1]!.enabled = false;

    expect(runtimeTaskModelRequest(
      config,
      'memoryExtraction',
      'passive-memory-extraction',
    )).toEqual({ model: 'passive-memory-extraction' });
  });

  it('keeps legacy memory model strings working until they are migrated', () => {
    const config = taskModelConfig();
    delete config.taskModels;
    config.memory.extractModel = 'legacy-extract-model';

    expect(runtimeTaskModelRequest(
      config,
      'memoryExtraction',
      'passive-memory-extraction',
    )).toEqual({ model: 'legacy-extract-model' });
  });
});

function taskModelConfig(): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp',
    storagePath: '/tmp/memories',
    activeProviderId: 'chat-provider',
    providers: [
      {
        id: 'chat-provider',
        name: 'Chat provider',
        provider: 'openai-compatible',
        baseUrl: 'https://chat.example/v1',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: '***',
        models: [{
          id: 'chat-model',
          name: 'Chat model',
          code: 'chat-model-code',
          enabled: true,
          maxOutputTokens: 8_192,
          thinkingEnabled: false,
          thinkingEfforts: [],
        }],
      },
      {
        id: 'background-provider',
        name: 'Background provider',
        provider: 'anthropic',
        baseUrl: 'https://background.example',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: '***',
        models: [{
          id: 'background-model',
          name: 'Background model',
          code: 'background-model-code',
          enabled: true,
          maxOutputTokens: 8_192,
          thinkingEnabled: false,
          thinkingEfforts: [],
        }],
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
        providerId: 'background-provider',
        modelId: 'background-model',
      },
    },
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}
