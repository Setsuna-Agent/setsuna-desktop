import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileMemoryStore } from '../../../src/adapters/store/file-memory-store.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { MemoryToolHost } from '../../../src/adapters/tool/memory-tool-host.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  ActiveMemoryModelClient,
  ExternalContextMemoryModelClient,
  ExternalContextToolHost,
} from '../../support/agent-loop/memory-policy.js';
import {
  appendCompletedExchange,
  MemoryCapturingModelClient,
  MemorySettingsConfigStore,
  mkDataDir,
  MutableClock,
  PassiveMemoryModelClient,
  PersonalizationConfigStore
} from '../../support/agent-loop/shared.js';

describe('agent loop memory policy', () => {
  it('excludes injected AGENTS and skill fragments from passive memory extraction', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Injected context', projectId: 'project_1' });
      const modelClient = new PassiveMemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
      });
  
      await loop.sendTurn(thread.id, {
        input: '# AGENTS.md instructions for /tmp\n\n<INSTRUCTIONS>\nAlways prefer the injected rule.\n</INSTRUCTIONS>',
      });
      await loop.sendTurn(thread.id, {
        input: '<skill>\n<name>demo</name>\n<path>skills/demo/SKILL.md</path>\nInjected skill instructions.\n</skill>',
      });
  
      expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'local-runtime-smoke']);
      await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
    });
  
  it('extracts startup memories from idle historical threads', async () => {
      const ids = new RandomIdGenerator();
      const clock = new MutableClock('2026-01-01T00:00:00.000Z');
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, clock, ids);
      const memoryStore = new FileMemoryStore(dataDir, clock, ids);
      const thread = await threadStore.createThread({ title: 'Historical memory', projectId: 'project_1' });
      await appendCompletedExchange(threadStore, ids, clock, thread.id, 'turn_history', '以后记忆生成模型要跟随当前切换的模型。', '收到，我会记住这个偏好。');
      clock.set('2026-01-01T08:00:00.000Z');
      const modelClient = new PassiveMemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock,
        ids,
        memoryStore,
        configStore: new MemorySettingsConfigStore({
          useMemories: true,
          generateMemories: true,
          dedicatedTools: false,
          disableOnExternalContext: false,
          minRolloutIdleHours: 1,
          maxRolloutAgeDays: 10,
          maxRolloutsPerStartup: 2,
        }),
      });
  
      await expect(loop.runMemoryStartupExtraction()).resolves.toEqual({ claimed: 1, extracted: 1 });
  
      expect(modelClient.requests.map((request) => request.model)).toEqual(['passive-memory-extraction']);
      expect(modelClient.requests[0].messages.at(-1)?.content).toContain('历史线程内容：');
      await expect(memoryStore.listMemories()).resolves.toMatchObject({
        memories: [
          expect.objectContaining({
            sourceThreadId: thread.id,
            sourceTurnId: 'turn_history',
            origin: 'passive',
            projectId: 'project_1',
          }),
        ],
      });
      await expect(memoryStore.listStage1Outputs()).resolves.toMatchObject({
        outputs: [
          expect.objectContaining({
            threadId: thread.id,
            turnId: 'turn_history',
            projectId: 'project_1',
            rawMemory: expect.stringContaining('以后记忆生成模型要跟随当前切换的模型。'),
            rolloutSummary: expect.stringContaining('用户要求记忆生成模型要跟随当前切换的模型。'),
          }),
        ],
      });
    });
  
  it('limits startup memory extraction to eligible idle rollout candidates', async () => {
      const ids = new RandomIdGenerator();
      const clock = new MutableClock('2026-01-01T00:00:00.000Z');
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, clock, ids);
      const memoryStore = new FileMemoryStore(dataDir, clock, ids);
      const oldThreadA = await threadStore.createThread({ title: 'Old A' });
      await appendCompletedExchange(threadStore, ids, clock, oldThreadA.id, 'turn_old_a', '请记住 A 偏好。', '好的。');
      clock.set('2026-01-01T01:00:00.000Z');
      const oldThreadB = await threadStore.createThread({ title: 'Old B' });
      await appendCompletedExchange(threadStore, ids, clock, oldThreadB.id, 'turn_old_b', '请记住 B 偏好。', '好的。');
      clock.set('2026-01-01T07:30:00.000Z');
      const freshThread = await threadStore.createThread({ title: 'Fresh' });
      await appendCompletedExchange(threadStore, ids, clock, freshThread.id, 'turn_fresh', '这条太新，不应启动抽取。', '好的。');
      clock.set('2026-01-01T08:00:00.000Z');
      const modelClient = new PassiveMemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock,
        ids,
        memoryStore,
        configStore: new MemorySettingsConfigStore({
          useMemories: true,
          generateMemories: true,
          dedicatedTools: false,
          disableOnExternalContext: false,
          minRolloutIdleHours: 1,
          maxRolloutAgeDays: 10,
          maxRolloutsPerStartup: 1,
        }),
      });
  
      await expect(loop.runMemoryStartupExtraction()).resolves.toEqual({ claimed: 1, extracted: 1 });
  
      expect(modelClient.requests).toHaveLength(1);
      const memories = await memoryStore.listMemories();
      expect(memories.memories).toHaveLength(1);
      expect(memories.memories[0].sourceThreadId).not.toBe(freshThread.id);
    });
  
  it('skips passive memory extraction when the same turn already saved an active memory', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Active memory', projectId: 'project_1' });
      const modelClient = new ActiveMemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        toolHost: new MemoryToolHost(memoryStore),
      });
  
      await loop.sendTurn(thread.id, { input: '请记住，当前仓库的样式需要尽可能使用 UnoCSS。' });
  
      const preview = await memoryStore.previewMemories();
      expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'local-runtime-smoke']);
      expect(preview.total).toBe(1);
      expect(preview.items).toMatchObject([
        {
          scope: 'project',
          origin: 'active',
          projectId: 'project_1',
          preview: '当前仓库的样式需要尽可能使用 UnoCSS。',
        },
      ]);
    });
  
  it('skips passive memory extraction when memories are disabled', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Disabled memory extraction' });
      const modelClient = new PassiveMemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        configStore: new PersonalizationConfigStore(),
      });
  
      await loop.sendTurn(thread.id, { input: 'do not extract memory' });
  
      await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
      expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke']);
    });
  
  it('does not expose memory tools to the model when memory is disabled', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const configStore = new MemorySettingsConfigStore({
        useMemories: false,
        generateMemories: false,
        dedicatedTools: true,
        disableOnExternalContext: true,
      });
      const thread = await threadStore.createThread({ title: 'Disabled memory tools' });
      await memoryStore.rememberMemory({ content: 'This memory should not be model-visible.' });
      const modelClient = new MemoryCapturingModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        configStore,
        toolHost: new MemoryToolHost(memoryStore, configStore),
      });
  
      await loop.sendTurn(thread.id, { input: 'do not use memory tools' });
  
      const toolNames = (modelClient.requests[0].tools ?? []).map((tool) => tool.name);
      expect(toolNames).not.toEqual(expect.arrayContaining(['remember_memory', 'recall_memory', 'list_memory_files', 'read_memory_file', 'search_memory_files']));
      expect(modelClient.requests[0].messages.map((message) => message.content).join('\n')).not.toContain('Memory tools read');
      expect(modelClient.requests[0].messages.map((message) => message.content).join('\n')).not.toContain('This memory should not be model-visible.');
    });
  
  it('can use memories without generating new memories', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Read-only memory' });
      await memoryStore.rememberMemory({ content: 'The user wants concise verification notes.' });
      const modelClient = new PassiveMemoryModelClient();
      const configStore = new MemorySettingsConfigStore({
        useMemories: true,
        generateMemories: false,
        dedicatedTools: true,
        disableOnExternalContext: true,
      });
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        configStore,
        toolHost: new MemoryToolHost(memoryStore, configStore),
      });
  
      await loop.sendTurn(thread.id, { input: 'answer using memory but do not extract' });
  
      expect(modelClient.requests).toHaveLength(1);
      expect(modelClient.requests[0].messages.map((message) => message.content).join('\n')).toContain('concise verification notes');
      const toolNames = (modelClient.requests[0].tools ?? []).map((tool) => tool.name);
      expect(toolNames).toEqual(['recall_memory']);
      await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 1 });
    });
  
  it('marks threads polluted after successful MCP tools and skips passive memory extraction', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'External context', memoryMode: 'enabled' });
      const modelClient = new ExternalContextMemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        toolHost: new ExternalContextToolHost(),
        configStore: new MemorySettingsConfigStore({
          useMemories: true,
          generateMemories: true,
          dedicatedTools: false,
          disableOnExternalContext: true,
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'search external context' });
  
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id);
      expect(saved?.memoryMode).toBe('polluted');
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'thread.memory_mode_updated',
          payload: {
            mode: 'polluted',
            reason: 'external_context:mcp__search__fetch',
          },
        }),
      ]));
      expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'local-runtime-smoke']);
      await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
    });
  
  it('marks threads polluted when tool output contains external context', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'External output marker', memoryMode: 'enabled' });
      const modelClient = new ExternalContextMemoryModelClient('external_search');
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        toolHost: new ExternalContextToolHost('external_search', true),
        configStore: new MemorySettingsConfigStore({
          useMemories: true,
          generateMemories: true,
          dedicatedTools: false,
          disableOnExternalContext: true,
        }),
      });
  
      await loop.sendTurn(thread.id, { input: 'search external context' });
  
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id);
      expect(saved?.memoryMode).toBe('polluted');
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'thread.memory_mode_updated',
          payload: {
            mode: 'polluted',
            reason: 'external_context:external_search',
          },
        }),
      ]));
      await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
    });
});
