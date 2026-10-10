// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeConfigState, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_THINKING_PREFERENCES_STORAGE_KEY,
  writeChatThinkingPreference,
} from '../../../../../src/features/chat/composer/chatThinkingPreferences.js';
import { useChatComposerModeController } from '../../../../../src/features/chat/composer/useChatComposerModeController.js';
import { useChatTurnActions } from '../../../../../src/features/chat/hooks/useChatTurnActions.js';
import { modelOptionKey } from '../../../../../src/shared/ui/model-picker/modelOptions.js';

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(CHAT_THINKING_PREFERENCES_STORAGE_KEY);
});

describe('message regeneration thinking settings', () => {
  it('uses the thread model’s latest thinking selection when retrying after a successful send', async () => {
    const config = runtimeConfig();
    const provider = config.providers[0]!;
    const model = provider.models[1]!;
    const currentThread: RuntimeThread = {
      id: 'thread_1', title: 'Thread', archived: false,
      createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
      messageCount: 1, lastMessagePreview: 'hello', lastSeq: 1,
      modelBinding: { providerId: provider.id, modelId: model.id, modelCode: model.code },
      messages: [{
        id: 'message_1', role: 'user', content: 'hello', status: 'complete',
        createdAt: '2026-10-10T00:00:00.000Z',
      }],
    };
    writeChatThinkingPreference(modelOptionKey(provider.id, provider.models[0]!.id), {
      enabled: true, effort: 'low',
    });
    const sendTurn = vi.fn(async () => ({ accepted: true as const, turnId: 'turn_sent' }));
    const regenerateFromMessage = vi.fn(async () => ({ accepted: true as const, turnId: 'turn_retry' }));
    const client = {
      sendTurn, regenerateFromMessage, getThread: async () => currentThread,
    } as unknown as DesktopRuntimeClient;
    const { result } = renderHook(() => ({
      composer: useChatComposerModeController({ currentThreadId: currentThread.id, provider, model }),
      actions: useChatTurnActions({
        activeProjectId: null, activeTurnId: null, claimComposerForThread: vi.fn(),
        client, config, composerKey: 'thread:thread_1', currentThread, draft: '',
        reloadThreads: async () => undefined,
        setActiveTurnId: vi.fn(), setCurrentThread: vi.fn(), setDraft: vi.fn(), setError: vi.fn(),
        terminalTurnIdsRef: { current: new Set<string>() },
      }),
    }));

    await act(async () => {
      const options = result.current.composer.createSendOptions({
        attachments: [], selectedSkillIds: [], selectedSkillReferences: [],
      });
      expect(await result.current.actions.sendInput('hello', options)).toBe(true);
    });
    expect(sendTurn).toHaveBeenCalledWith(currentThread.id, expect.objectContaining({ thinking: false }));

    act(() => {
      result.current.composer.setThinkingEnabled(true);
      result.current.composer.setThinkingEffort('xhigh');
    });
    await act(async () => result.current.actions.editUserMessage('message_1', 'hello'));
    expect(regenerateFromMessage).toHaveBeenLastCalledWith(currentThread.id, 'message_1', {
      content: 'hello', thinking: true, thinkingEffort: 'xhigh',
    });

    act(() => result.current.composer.setThinkingEnabled(false));
    await act(async () => result.current.actions.editUserMessage('message_1', 'edited hello'));
    expect(regenerateFromMessage).toHaveBeenLastCalledWith(currentThread.id, 'message_1', {
      content: 'edited hello', thinking: false,
    });
  });
});

function runtimeConfig(): RuntimeConfigState {
  return {
    configPath: '/config.json', dataPath: '/data', storagePath: '/storage',
    activeProviderId: 'provider_1', globalPrompt: '', setsunaStyle: 'developer',
    approvalPolicy: 'on-request', permissionProfile: 'workspace-write',
    providers: [{
      id: 'provider_1', name: 'Provider', provider: 'openai-compatible',
      baseUrl: 'https://provider.example.test', enabled: true, apiKeySet: true, apiKeyPreview: '***',
      models: [{
        id: 'default_model', name: 'Default', code: 'default-code', enabled: true,
        maxOutputTokens: 4096, thinkingEnabled: true, thinkingEfforts: ['low'],
      }, {
        id: 'thread_model', name: 'Thread model', code: 'thread-code', enabled: false,
        maxOutputTokens: 4096, thinkingEnabled: true, thinkingEfforts: ['high', 'xhigh'],
        defaultThinkingEffort: 'high',
      }],
    }],
  };
}
