import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileMemoryStore } from '../../../src/adapters/store/file-memory-store.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  ActiveMemorySettingsConfigStore,
  BlockingPassiveMemoryModelClient,
  CodexStage1MemoryModelClient,
  ConsolidatingCodexMemoryModelClient,
  NoOutputStage1MemoryModelClient,
} from '../../support/agent-loop/memory-extraction.js';
import {
  appendCompletedExchange,
  CapturingUsageStore,
  MemorySettingsConfigStore,
  mkDataDir,
  MutableClock,
  PassiveMemoryModelClient,
  waitForTestState,
  waitForTurnCompleted
} from '../../support/agent-loop/shared.js';

describe('agent loop memory extraction', () => {
  it('extracts passive memories after completed turns without exposing a tool call', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Memory extraction', projectId: 'project_1' });
      const modelClient = new PassiveMemoryModelClient();
      const usageStore = new CapturingUsageStore();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        usageStore,
      });
  
      await loop.sendTurn(thread.id, { input: '以后记忆生成模型要跟随当前切换的模型。' });
  
      const preview = await memoryStore.previewMemories();
      expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'passive-memory-extraction']);
      expect(modelClient.requests[1]).toMatchObject({
        maxOutputTokens: 900,
        temperature: 0,
        toolChoice: 'none',
      });
      expect(modelClient.requests[1].tools).toBeUndefined();
      expect(preview.items).toMatchObject([
        {
          title: '记忆模型',
          scope: 'project',
          origin: 'passive',
          projectId: 'project_1',
          source: 'Memory extraction',
          tags: ['memory', 'model'],
        },
      ]);
      expect(preview.items[0].preview).toContain('记忆生成模型要跟随当前切换的模型');
      expect(usageStore.records).toMatchObject([{ provider: 'test-provider', model: 'selected-model' }]);
      await expect(memoryStore.listStage1Outputs()).resolves.toMatchObject({
        outputs: [
          expect.objectContaining({
            threadId: thread.id,
            turnId: expect.any(String),
            projectId: 'project_1',
            rawMemory: expect.stringContaining('以后记忆生成模型要跟随当前切换的模型。'),
            rolloutSummary: expect.stringContaining('用户要求记忆生成模型要跟随当前切换的模型。'),
          }),
        ],
      });
    });
  
  it('does not keep the active turn open while passive memory extraction is blocked', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Background memory extraction' });
      const modelClient = new BlockingPassiveMemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
      });
  
      const first = await loop.startTurn(thread.id, { input: 'first turn' });
      await waitForTurnCompleted(threadStore, thread.id, first.turnId);
      await modelClient.waitForPassiveStart();
      await waitForTestState(
        () => loop.activeTurnId(thread.id),
        (turnId) => turnId === null,
        (turnId) => `Expected the first turn to be idle; activeTurnId=${String(turnId)}`,
      );
  
      const second = await loop.startTurn(thread.id, { input: 'second turn' });
      await waitForTurnCompleted(threadStore, thread.id, second.turnId);
      expect(modelClient.requests.filter((request) => request.model === 'local-runtime-smoke')).toHaveLength(2);
      expect(modelClient.requests.filter((request) => request.model === 'passive-memory-extraction')).toHaveLength(1);
  
      await expect(loop.shutdown('test shutdown', 2_000)).resolves.toBe(true);
      expect(modelClient.passiveAborted).toBe(true);
    });
  
  it('uses the configured model for passive memory extraction', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Memory extraction model', projectId: 'project_1' });
      const modelClient = new PassiveMemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        configStore: new MemorySettingsConfigStore({
          useMemories: true,
          generateMemories: true,
          dedicatedTools: false,
          disableOnExternalContext: false,
          extractModel: 'memory-extract-model',
        }),
      });
  
      await loop.sendTurn(thread.id, { input: '以后记忆生成模型要用单独配置的模型。' });
  
      expect(modelClient.requests.map((request) => request.model)).toEqual(['local-runtime-smoke', 'memory-extract-model']);
      await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 1 });
    });
  
  it('prefers Codex stage-1 fields from passive memory extraction output', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Codex stage one', projectId: 'project_1' });
      const modelClient = new CodexStage1MemoryModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
      });
  
      await loop.sendTurn(thread.id, { input: '以后记忆生成模型要跟随当前切换的模型。' });
  
      expect(modelClient.requests[1].messages[0].content).toContain('raw_memory');
      await expect(memoryStore.listStage1Outputs()).resolves.toMatchObject({
        outputs: [
          expect.objectContaining({
            threadId: thread.id,
            status: 'succeeded',
            rawMemory: '## Durable Preference\nUser wants passive memory extraction to follow the currently selected model.',
            rolloutSummary: 'User prefers passive memory extraction to follow the selected model.',
            rolloutSlug: 'memory-model-routing',
          }),
        ],
      });
      await expect(memoryStore.previewMemories()).resolves.toMatchObject({
        items: [
          expect.objectContaining({
            preview: expect.stringContaining('记忆生成模型要跟随当前切换的模型'),
          }),
        ],
      });
      await expect(memoryStore.syncPhase2Workspace()).resolves.toMatchObject({
        hasChanges: true,
        diffPath: 'phase2_workspace_diff.md',
        changes: expect.arrayContaining([
          expect.objectContaining({ path: 'raw_memories.md' }),
        ]),
      });
    });
  
  it('runs phase-2 consolidation with a locked-down internal memory agent', async () => {
      const ids = new RandomIdGenerator();
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const memoryStore = new FileMemoryStore(dataDir, systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Codex phase two', projectId: 'project_1' });
      const modelClient = new ConsolidatingCodexMemoryModelClient();
      const usageStore = new CapturingUsageStore();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        memoryStore,
        usageStore,
        configStore: new ActiveMemorySettingsConfigStore({
          useMemories: true,
          generateMemories: true,
          dedicatedTools: false,
          disableOnExternalContext: false,
        }),
      });
  
      await loop.sendTurn(thread.id, { input: '以后记忆生成模型要跟随当前切换的模型。' });
  
      expect(modelClient.requests.map((request) => request.model)).toEqual([
        'local-runtime-smoke',
        'passive-memory-extraction',
        'memory-consolidation',
        'memory-consolidation',
      ]);
      expect(modelClient.requests[2].tools?.map((tool) => tool.name)).toEqual([
        'list_directory',
        'read_file',
        'search_text',
        'write_file',
        'delete_file',
      ]);
      await expect(memoryStore.readMemoryFile({ path: 'memory_summary.md' })).resolves.toMatchObject({
        content: expect.stringMatching(/^v1\n/),
      });
      await expect(memoryStore.readMemoryFile({ path: 'MEMORY.md' })).resolves.toMatchObject({
        content: expect.stringContaining('# Task Group: Memory model routing'),
      });
      await expect(memoryStore.syncPhase2Workspace()).resolves.toMatchObject({
        hasChanges: false,
        changes: [],
      });
      await expect(memoryStore.claimPhase2Job({ ownerId: 'after_success', leaseSeconds: 60, retryDelaySeconds: 60 })).resolves.toMatchObject({
        status: 'skipped_no_input',
      });
      expect(usageStore.records).toMatchObject([{
        threadId: thread.id,
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
      }]);
    });
  
  it('records startup stage-1 no-output results and skips the same rollout later', async () => {
      const ids = new RandomIdGenerator();
      const clock = new MutableClock('2026-01-01T00:00:00.000Z');
      const dataDir = await mkDataDir();
      const threadStore = new JsonThreadStore(dataDir, clock, ids);
      const memoryStore = new FileMemoryStore(dataDir, clock, ids);
      const thread = await threadStore.createThread({ title: 'No durable memory', projectId: 'project_1' });
      await appendCompletedExchange(threadStore, ids, clock, thread.id, 'turn_empty', '今天随便问一句天气。', '这类实时信息下次应重新查询。');
      clock.set('2026-01-01T08:00:00.000Z');
      const modelClient = new NoOutputStage1MemoryModelClient();
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
  
      await expect(loop.runMemoryStartupExtraction()).resolves.toEqual({ claimed: 1, extracted: 0 });
      await expect(loop.runMemoryStartupExtraction()).resolves.toEqual({ claimed: 0, extracted: 0 });
      expect(modelClient.requests).toHaveLength(1);
      await expect(memoryStore.listStage1Outputs()).resolves.toMatchObject({
        outputs: [
          expect.objectContaining({
            threadId: thread.id,
            turnId: 'turn_empty',
            status: 'succeeded_no_output',
            rawMemory: '',
            rolloutSummary: '',
          }),
        ],
      });
      await expect(memoryStore.previewMemories()).resolves.toMatchObject({ total: 0, items: [] });
      await expect(memoryStore.readMemoryFile({ path: 'raw_memories.md' })).resolves.toMatchObject({
        content: expect.stringContaining('No raw memories yet.'),
      });
    });
});
