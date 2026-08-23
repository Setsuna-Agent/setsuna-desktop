import type { RuntimeConfigState } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { runtimeTaskModelRequest } from '../../../src/loop/core/runtime-task-model.js';

describe('runtime task model selection', () => {
  it('resolves the dedicated thread title model', () => {
    const config = taskModelConfig();

    expect(runtimeTaskModelRequest(
      config,
      'threadTitle',
      'chat-model-code',
    )).toEqual({
      model: 'background-model-code',
      providerId: 'background-provider',
    });
  });

  it('resolves the dedicated review model', () => {
    const config = taskModelConfig();

    expect(runtimeTaskModelRequest(
      config,
      'review',
      'chat-model-code',
    )).toEqual({
      model: 'background-model-code',
      providerId: 'background-provider',
    });
  });

  it('resolves the dedicated approval review model independently', () => {
    const config = taskModelConfig();

    expect(runtimeTaskModelRequest(
      config,
      'approvalReview',
      'chat-model-code',
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
      'threadTitle',
      'chat-model-code',
    )).toEqual({ model: 'chat-model-code' });
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
    taskModels: {
      threadTitle: {
        providerId: 'background-provider',
        modelId: 'background-model',
      },
      review: {
        providerId: 'background-provider',
        modelId: 'background-model',
      },
      approvalReview: {
        providerId: 'background-provider',
        modelId: 'background-model',
      },
    },
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
  };
}
