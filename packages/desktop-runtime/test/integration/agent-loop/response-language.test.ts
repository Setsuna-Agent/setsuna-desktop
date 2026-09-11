import { describe, expect, it } from 'vitest';
import { createReviewTurnRequest } from '@setsuna-desktop/feature-review/runtime';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID } from '../../../src/loop/context/runtime-response-language.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  CapturingToolHost,
  mkDataDir,
  ToolCallingModelClient,
  waitForTurnCompleted,
} from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';

describe('agent loop response language', () => {
  it.each([
    { mode: 'regular', locale: 'zh-CN' },
    { mode: 'review', locale: 'zh-CN' },
    { mode: 'review', locale: 'en-US' },
  ] as const)('pins Chinese response instructions across an English tool-result follow-up in $mode mode ($locale UI)', async ({ mode, locale }) => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Response language', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new CapturingToolHost(),
    });

    const input = '帮我检查一下最新的提交';
    if (mode === 'review') {
      // 中文自定义审查应跟随原始用户输入，而不是界面语言或英文工具输出。
      const started = await loop.startReviewTurn(thread.id, createReviewTurnRequest(
        { type: 'custom', instructions: input },
        locale,
      ));
      await waitForTurnCompleted(threadStore, thread.id, started.turnId);
    } else {
      await loop.sendTurn(thread.id, { input });
    }

    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1].messages).toContainEqual(expect.objectContaining({
      role: 'tool',
      content: expect.stringContaining('file contents from tool'),
    }));
    const languageMessages = modelClient.requests.map((request) => (
      request.messages.find((message) => message.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID)
    ));
    expect(languageMessages).toEqual([
      expect.objectContaining({
        role: 'developer',
        content: expect.stringContaining('本轮回答的目标语言是简体中文'),
      }),
      expect.objectContaining({
        role: 'developer',
        content: expect.stringContaining('本轮回答的目标语言是简体中文'),
      }),
    ]);
    expect(languageMessages[0]?.content).toBe(languageMessages[1]?.content);
    expect(modelClient.requests.every((request) => (
      request.messages.filter((message) => message.role === 'system' || message.role === 'developer').at(-1)?.id
        === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID
    ))).toBe(true);
    expect(modelClient.requests.every((request) => request.stepSnapshot?.promptManifest?.some(
      (entry) => entry.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID
        && entry.role === 'developer'
        && entry.source === 'product'
        && entry.trust === 'runtime'
        && entry.lifecycle === 'turn',
    ))).toBe(true);
  });
});
