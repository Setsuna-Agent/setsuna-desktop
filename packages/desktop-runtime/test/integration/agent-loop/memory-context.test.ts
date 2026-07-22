import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileMemoryStore } from '../../../src/adapters/store/file-memory-store.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { MemoryToolHost } from '../../../src/adapters/tool/memory-tool-host.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  MemoryCitationModelClient,
  RememberMemoryToolModelClient,
} from '../../support/agent-loop/memory-context.js';
import {
  MemoryCapturingModelClient,
  mkDataDir,
  PersonalizationConfigStore
} from '../../support/agent-loop/shared.js';

describe('agent loop memory context', () => {
  it('injects local memories into model context', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Memory loop' });
      await memoryStore.rememberMemory({ content: 'The user prefers local-only runtime answers.' });
      const modelClient = new MemoryCapturingModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
      });
  
      await loop.sendTurn(thread.id, { input: 'what should you remember?' });
  
      const memoryContext = modelClient.requests[0].messages.find((message) => message.id === 'memory_context');
      expect(memoryContext).toMatchObject({ role: 'user' });
      expect(memoryContext?.content).toContain('<memory_context>');
      expect(memoryContext?.content).toContain('local-only runtime answers');
      expect(memoryContext?.content).toContain('source="MEMORY.md:');
      expect(memoryContext?.content).toContain('<oai-mem-citation>');
      expect(memoryContext?.content).not.toContain('========= MEMORY_SUMMARY BEGINS =========');
      expect(memoryContext?.content).toContain('<rollout_ids>');
    });
  
  it('keeps project memory context isolated from other projects and shared summaries', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Project alpha', projectId: 'project_alpha' });
      await memoryStore.rememberMemory({ content: 'Global preference is safe everywhere.', scope: 'global' });
      await memoryStore.rememberMemory({ content: 'Project alpha uses pnpm.', scope: 'project', projectId: 'project_alpha' });
      await memoryStore.rememberMemory({ content: 'Project beta must stay hidden.', scope: 'project', projectId: 'project_beta' });
      const modelClient = new MemoryCapturingModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
      });
  
      await loop.sendTurn(thread.id, { input: 'which package manager does this project use?' });
  
      const memoryContext = modelClient.requests[0].messages.find((message) => message.id === 'memory_context')?.content ?? '';
      expect(memoryContext).toContain('Global preference is safe everywhere.');
      expect(memoryContext).toContain('Project alpha uses pnpm.');
      expect(memoryContext).toContain('project_id="project_alpha"');
      expect(memoryContext).not.toContain('Project beta must stay hidden.');
      expect(memoryContext).not.toContain('========= MEMORY_SUMMARY BEGINS =========');
    });
  
  it('strips hidden memory citations from assistant output and stores citation metadata', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const citedMemory = await memoryStore.rememberMemory({ content: 'Cited local memory.', sourceThreadId: 'thread_a' });
      const thread = await threadStore.createThread({ title: 'Memory citation' });
      const loop = new AgentLoop({
        threadStore,
        modelClient: new MemoryCitationModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
      });
  
      await loop.sendTurn(thread.id, { input: 'answer with citation' });
  
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
      const assistant = saved?.messages.find((message) => message.role === 'assistant');
      expect(assistant?.content).toBe('Answer  done.');
      expect(assistant?.memoryCitation).toEqual({
        entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' }],
        rolloutIds: ['thread_a', 'thread_b'],
      });
      expect(events.filter((event) => event.type === 'message.delta').map((event) => event.payload.text).join('')).toBe('Answer  done.');
      expect(events.find((event) => event.type === 'message.completed')).toMatchObject({
        payload: {
          memoryCitation: {
            entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' }],
            rolloutIds: ['thread_a', 'thread_b'],
          },
        },
      });
      await expect(memoryStore.listMemories()).resolves.toMatchObject({
        memories: expect.arrayContaining([
          expect.objectContaining({ id: citedMemory.id, usageCount: 1, lastUsedAt: expect.any(String) }),
        ]),
      });
    });
  
  it('stores explicit user memory requests even when the model does not call the memory tool', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Explicit memory', projectId: 'project_1' });
      const loop = new AgentLoop({
        threadStore,
        modelClient: new MemoryCapturingModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
      });
  
      await loop.sendTurn(thread.id, { input: '请记住：这个项目用 pnpm 管理依赖。' });
  
      await expect(memoryStore.listMemories({ projectId: 'project_1' })).resolves.toMatchObject({
        memories: [
          {
            scope: 'project',
            projectId: 'project_1',
            content: '这个项目用 pnpm 管理依赖',
            sourceThreadId: thread.id,
          },
        ],
      });
    });
  
  it('does not duplicate explicit memories when the memory tool already saved them', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Memory tool', projectId: 'project_1' });
      const loop = new AgentLoop({
        threadStore,
        modelClient: new RememberMemoryToolModelClient(),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        toolHost: new MemoryToolHost(memoryStore),
      });
  
      await loop.sendTurn(thread.id, { input: '请记住：这个项目用 pnpm 管理依赖。' });
  
      const list = await memoryStore.listMemories({ projectId: 'project_1' });
      expect(list.memories).toHaveLength(1);
      expect(list.memories[0]).toMatchObject({
        scope: 'project',
        projectId: 'project_1',
        content: '这个项目用 pnpm 管理依赖。',
        sourceThreadId: thread.id,
      });
    });
  
  it('injects desktop personalization and honors disabled memories', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Personalization loop' });
      await memoryStore.rememberMemory({ content: 'This memory should stay out.' });
      const modelClient = new MemoryCapturingModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        configStore: new PersonalizationConfigStore(),
      });
  
      await loop.sendTurn(thread.id, { input: 'how should you answer?' });
  
      const contents = modelClient.requests[0].messages.map((message) => message.content).join('\n');
      expect(contents).toContain('Desktop personalization:');
      expect(contents).toContain('more everyday, conversational tone');
      expect(contents).toContain('Prefer crisp context before the answer.');
      expect(contents).not.toContain('<memory_context>');
      expect(contents).not.toContain('This memory should stay out.');
    });
});
