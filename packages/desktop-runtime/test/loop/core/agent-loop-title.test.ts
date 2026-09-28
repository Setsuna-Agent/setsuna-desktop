import { fallbackThreadTitle, type ModelRequest, type ModelStreamEvent } from '@setsuna-desktop/contracts';
import type { ThreadTitleGenerationControl } from '@setsuna-desktop/feature-thread-title-generation/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import type { UsageRecorder } from '../../../src/ports/usage-store.js';
import { closeTestThreadStores, createTestThreadStore } from '../../support/thread-store.js';

const testDirs: string[] = [];

afterEach(async () => {
  await closeTestThreadStores();
  await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('agent loop thread title Feature seam', () => {
  it.each(['complete', 'cancelled', 'failed'] as const)(
    'lets the first turn settle as %s while its title is still pending', async (outcome) => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await testDataDir(), systemClock, ids);
      const recordUsage = vi.fn<UsageRecorder['recordUsage']>(async (input) => ({ id: ids.id('usage'), ...input }));
      const thread = await threadStore.createThread();
      const eventBus = new InMemoryEventBus();
      const publishedEvents: string[] = [];
      eventBus.subscribe(thread.id, (event) => publishedEvents.push(event.type));
      const loop = new AgentLoop({
        threadStore,
        modelClient: new AnswerModelClient(outcome),
        eventBus,
        clock: systemClock,
        ids,
        usageStore: { recordUsage },
      });
      const host = loop.threadTitleGenerationRuntimeHost();
      let finishTitle!: (title: string) => void;
      const titleResult = new Promise<string>((resolve) => { finishTitle = resolve; });
      const start = vi.fn<ThreadTitleGenerationControl['start']>(async (input) => {
        const title = await titleResult;
        await host.recordUsage(input.thread.id, input.turnId, { model: 'title-model', totalTokens: 23 });
        await host.appendTitleUpdate(input.thread.id, input.turnId, title);
      });
      loop.bindThreadTitleGenerationControl({ available: true, start });

      const turn = loop.sendTurn(thread.id, { input: '检查自动标题 Feature 接缝' });
      if (outcome === 'failed') await expect(turn).rejects.toThrow('Model failed');
      else await turn;

      expect(publishedEvents).not.toContain('thread.updated');
      const settledThread = await threadStore.getThread(thread.id);
      expect(settledThread?.title).toBe(fallbackThreadTitle('检查自动标题 Feature 接缝'));
      expect(start).toHaveBeenCalledWith(expect.objectContaining({
        attachmentCount: 0,
        taskKind: 'regular',
        userContent: '检查自动标题 Feature 接缝',
      }));
      finishTitle('Feature 生成标题');
      await start.mock.results[0]!.value;

      const updatedThread = await threadStore.getThread(thread.id);
      expect(updatedThread?.title).toBe('Feature 生成标题');
      expect(publishedEvents).toContain('thread.updated');
      const events = await threadStore.listEvents(thread.id);
      expect(events.find((event) => event.type === 'feature.event')).toMatchObject({
        type: 'feature.event',
        featureId: 'usage',
        eventType: 'usage.recorded',
      });
      expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ threadId: thread.id, totalTokens: 23 }));
      expect(updatedThread?.activeTurnId).toBeFalsy();
      expect(updatedThread?.turns).toEqual(settledThread?.turns);
      expect(updatedThread?.messages).toEqual(settledThread?.messages);
      if (outcome === 'complete') {
        expect(publishedEvents.indexOf('turn.completed')).toBeLessThan(publishedEvents.indexOf('feature.event'));
      }
    },
  );
});

class AnswerModelClient implements ModelClient {
  constructor(private readonly outcome: 'complete' | 'cancelled' | 'failed') {}

  async *stream(_request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    if (this.outcome === 'cancelled') throw new DOMException('Turn cancelled', 'AbortError');
    if (this.outcome === 'failed') throw new Error('Model failed');
    yield { type: 'text_delta', text: '主回答正常完成' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

async function testDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-title-test-'));
  testDirs.push(dir);
  return dir;
}
