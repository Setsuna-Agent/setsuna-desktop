import { describe, expect, it } from 'vitest';
import { createReviewTurnRequest } from '@setsuna-desktop/feature-review/runtime';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  SingleToolCallModelClient,
  TestConfigStore,
} from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { createHost } from '../adapters/tool/pc-local-tool-host.support.js';

describe('agent loop response language', () => {
  it('switches built-in prompts and tool descriptions in an existing thread without changing tool schemas', async () => {
    const { host, projectDir, projectId } = await createHost();
    await writeFile(path.join(projectDir, 'README.md'), 'English tool output must not choose the reply language.');
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Language switch', projectId });
    const config = await new TestConfigStore().getConfig();
    config.desktopSettings = { interfaceLanguage: 'zh-CN' };
    const modelClient = new SingleToolCallModelClient({
      id: 'read_1', name: 'read_file', arguments: '{"file_path":"README.md"}',
    });
    const loop = new AgentLoop({
      threadStore, modelClient, ids, toolHost: host,
      configStore: new TestConfigStore(config),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      environmentResolver: { resolve: async () => ({
        id: projectId, cwd: projectDir, workspaceRoot: projectDir, workspaceRoots: [projectDir],
      }) },
    });

    await loop.sendTurn(thread.id, { input: 'Inspect README.md' });
    const chineseRequests = [...modelClient.requests];
    expect(chineseRequests).toHaveLength(2);
    expect(chineseRequests[1].messages).toContainEqual(expect.objectContaining({
      role: 'tool', content: expect.stringContaining('English tool output'),
    }));
    for (const request of chineseRequests) {
      expect(request.messages.find((message) => message.id === 'desktop_runtime_base')?.content).toContain('你是 Setsuna');
      expect(request.messages.find((message) => message.id === 'desktop_local_tool_rules')?.content).toContain('本地工具直接操作');
      expect(request.messages.find((message) => message.id === 'desktop_runtime_permissions')?.content).toContain('运行时权限');
      expect(request.messages.find((message) => message.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID)?.content).toContain('目标语言是简体中文');
      expect(request.tools?.find((tool) => tool.name === 'read_file')?.description).toContain('读取');
    }

    config.desktopSettings = { interfaceLanguage: 'en-US' };
    modelClient.requests = [];
    await loop.sendTurn(thread.id, { input: '继续检查 README.md' });
    expect(modelClient.requests).toHaveLength(2);
    for (const request of modelClient.requests) {
      expect(request.messages.find((message) => message.id === 'desktop_runtime_base')?.content).toContain('You are Setsuna');
      expect(request.messages.find((message) => message.id === 'desktop_local_tool_rules')?.content).toContain('Local tools operate directly');
      expect(request.messages.find((message) => message.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID)?.content).toContain('response language for this turn is English');
      expect(request.tools?.find((tool) => tool.name === 'read_file')?.description).toContain('Read a UTF-8');
    }
    expect(withoutDescriptions(modelClient.requests[0].tools)).toEqual(withoutDescriptions(chineseRequests[0].tools));

    modelClient.requests = [];
    await loop.sendTurn(thread.id, { input: 'Please answer in Chinese' });
    expect(modelClient.requests[0].messages.find((message) => message.id === 'desktop_runtime_base')?.content).toContain('You are Setsuna');
    expect(modelClient.requests[0].messages.find((message) => message.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID)?.content).toContain('目标语言是简体中文');

    config.desktopSettings = { interfaceLanguage: 'zh-CN' };
    for (const input of ['Please use English.', 'English please.']) {
      modelClient.requests = [];
      await loop.sendTurn(thread.id, { input });
      expect(modelClient.requests).toHaveLength(2);
      for (const request of modelClient.requests) {
        expect(request.messages.find((message) => message.id === 'desktop_runtime_base')?.content).toContain('你是 Setsuna');
        expect(request.messages.find((message) => message.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID)).toMatchObject({
          role: 'developer', content: expect.stringContaining('response language for this turn is English'),
        });
      }
    }

    const runTool = host.runTool.bind(host);
    host.runTool = async (...args) => {
      const result = await runTool(...args);
      config.desktopSettings = { interfaceLanguage: 'en-US' };
      return result;
    };
    modelClient.requests = [];
    await loop.sendTurn(thread.id, { input: '再读一遍 README.md' });
    expect(modelClient.requests[0].messages.find((message) => message.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID)?.content).toContain('目标语言是简体中文');
    expect(modelClient.requests[1].messages.find((message) => message.id === RUNTIME_RESPONSE_LANGUAGE_PROMPT_ID)?.content).toContain('response language for this turn is English');
    expect(modelClient.requests[1].tools?.find((tool) => tool.name === 'read_file')?.description).toContain('Read a UTF-8');
  });

  it.each([
    { mode: 'regular', locale: 'zh-CN' },
    { mode: 'review', locale: 'zh-CN' },
    { mode: 'review', locale: 'en-US' },
  ] as const)('pins Chinese response instructions across an English tool-result follow-up in $mode mode ($locale UI)', async ({ mode, locale }) => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Response language', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const config = await new TestConfigStore().getConfig();
    config.desktopSettings = { interfaceLanguage: locale };
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new CapturingToolHost(),
      configStore: new TestConfigStore(config),
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

function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => key !== 'description' || typeof item !== 'string')
    .map(([key, item]) => [key, withoutDescriptions(item)]));
}
