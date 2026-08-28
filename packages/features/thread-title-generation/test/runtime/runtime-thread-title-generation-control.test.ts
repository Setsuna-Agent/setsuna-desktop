import {
  DEFAULT_THREAD_TITLE,
  fallbackThreadTitle,
  type RuntimeThread,
  type RuntimeUsage,
  type StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureSettingsRevisionConflictError } from '@setsuna-desktop/feature-core/settings';
import { describe, expect, it, vi } from 'vitest';
import type {
  ThreadTitleGenerationModelSelection,
  ThreadTitleGenerationRuntimeHost,
} from '../../src/contracts/index.js';
import { threadTitleGenerationFeature } from '../../src/contracts/index.js';
import { RuntimeThreadTitleGenerationControl } from '../../src/runtime/runtime-thread-title-generation-control.js';

const NOW = '2026-08-28T08:00:00.000Z';
const usage: RuntimeUsage = {
  provider: 'openai-compatible',
  model: 'title-model',
  inputTokens: 18,
  outputTokens: 5,
  totalTokens: 23,
};

describe('RuntimeThreadTitleGenerationControl', () => {
  it('generates on the first regular turn and commits usage plus the title', async () => {
    const current = threadAfterFirstMessage('请分析自动标题的归属');
    const recordUsage = vi.fn<ThreadTitleGenerationRuntimeHost['recordUsage']>();
    const appendTitleUpdate = vi.fn<ThreadTitleGenerationRuntimeHost['appendTitleUpdate']>();
    const host = runtimeHost({ current, recordUsage, appendTitleUpdate });
    const control = activeControl(host, { providerId: 'provider-title', modelId: 'model-title' });

    const generation = control.start({
      attachmentCount: 0,
      conversationModel: { model: 'chat-model', providerId: 'provider-chat' },
      signal: new AbortController().signal,
      taskKind: 'regular',
      thread: emptyThread(),
      userContent: '请分析自动标题的归属',
    });
    await control.commit(current.id, 'turn_1', generation);

    expect(host.resolveModel).toHaveBeenCalledWith({
      selection: { providerId: 'provider-title', modelId: 'model-title' },
      fallback: { model: 'chat-model', providerId: 'provider-chat' },
    });
    expect(recordUsage).toHaveBeenCalledWith(current.id, 'turn_1', usage);
    expect(appendTitleUpdate).toHaveBeenCalledWith(current.id, 'turn_1', '自动标题 Feature 归属');
  });

  it('does not overwrite an explicit rename made while generation is running', async () => {
    const current = threadAfterFirstMessage('生成标题');
    const appendTitleUpdate = vi.fn<ThreadTitleGenerationRuntimeHost['appendTitleUpdate']>();
    const host = runtimeHost({
      current,
      appendTitleUpdate,
      events: [{ type: 'thread.updated', payload: { title: '用户手动标题' } } as StoredThreadEvent],
    });
    const control = activeControl(host, null);

    const generation = control.start({
      attachmentCount: 0,
      conversationModel: { model: 'chat-model' },
      signal: new AbortController().signal,
      taskKind: 'regular',
      thread: emptyThread(),
      userContent: '生成标题',
    });
    await control.commit(current.id, 'turn_1', generation);

    expect(appendTitleUpdate).not.toHaveBeenCalled();
  });

  it('preserves revision conflict semantics when saving settings', async () => {
    const current = threadAfterFirstMessage('生成标题');
    const control = activeControl(
      runtimeHost({ current }),
      null,
      new FeatureSettingsRevisionConflictError(2, null),
    );

    await expect(control.updateSettings({
      expectedRevision: 1,
      selection: { providerId: 'provider-title', modelId: 'model-title' },
    })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      retryable: true,
    });
  });
});

function activeControl(
  host: ThreadTitleGenerationRuntimeHost,
  selection: ThreadTitleGenerationModelSelection,
  updateError?: unknown,
): RuntimeThreadTitleGenerationControl {
  const controller = createFeatureScope({
    featureId: threadTitleGenerationFeature.id,
    process: 'runtime',
    scopeId: 'thread-title-generation:test',
  });
  controller.activate();
  return new RuntimeThreadTitleGenerationControl(controller.scope, {
    read: async () => ({ value: selection, revision: 0 }),
    readPublic: async () => ({ value: selection, revision: 0 }),
    update: async ({ patch }) => {
      if (updateError) throw updateError;
      return { value: patch, revision: 1 };
    },
  }, host);
}

function runtimeHost({
  appendTitleUpdate = vi.fn<ThreadTitleGenerationRuntimeHost['appendTitleUpdate']>(),
  current,
  events = [],
  recordUsage = vi.fn<ThreadTitleGenerationRuntimeHost['recordUsage']>(),
}: Readonly<{
  appendTitleUpdate?: ThreadTitleGenerationRuntimeHost['appendTitleUpdate'];
  current: RuntimeThread;
  events?: StoredThreadEvent[];
  recordUsage?: ThreadTitleGenerationRuntimeHost['recordUsage'];
}>): ThreadTitleGenerationRuntimeHost {
  return {
    now: () => new Date(NOW),
    resolveModel: vi.fn(async () => ({ model: 'title-model', providerId: 'provider-title' })),
    listModelOptions: async () => [],
    generateText: async () => ({
      content: '{"title":"自动标题 Feature 归属"}',
      finishReason: 'stop',
      usage,
    }),
    recordUsage,
    flushThread: async () => undefined,
    listEvents: async () => events,
    getThread: async () => current,
    appendTitleUpdate,
  };
}

function emptyThread(): RuntimeThread {
  return {
    id: 'thread_1',
    title: DEFAULT_THREAD_TITLE,
    createdAt: NOW,
    updatedAt: NOW,
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    lastSeq: 0,
    messages: [],
  };
}

function threadAfterFirstMessage(content: string): RuntimeThread {
  return {
    ...emptyThread(),
    title: fallbackThreadTitle(content),
    messageCount: 1,
    lastMessagePreview: content,
    lastSeq: 2,
    messages: [{
      id: 'message_1',
      role: 'user',
      content,
      createdAt: NOW,
      status: 'complete',
    }],
  };
}
