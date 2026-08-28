import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import type {
  ThreadTitleGeneration,
  ThreadTitleGenerationControl,
} from '@setsuna-desktop/feature-thread-title-generation/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { closeTestThreadStores, createTestThreadStore } from '../../support/thread-store.js';

const testDirs: string[] = [];

afterEach(async () => {
  await closeTestThreadStores();
  await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('agent loop thread title Feature seam', () => {
  it('delegates first-turn generation and commits the Feature title before turn completion', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await testDataDir(), systemClock, ids);
    const thread = await threadStore.createThread();
    const eventBus = new InMemoryEventBus();
    const publishedEvents: string[] = [];
    eventBus.subscribe(thread.id, (event) => publishedEvents.push(event.type));
    const loop = new AgentLoop({
      threadStore,
      modelClient: new AnswerModelClient(),
      eventBus,
      clock: systemClock,
      ids,
    });
    const host = loop.threadTitleGenerationRuntimeHost();
    const start = vi.fn<ThreadTitleGenerationControl['start']>((input) => ({
      initialSeq: input.thread.lastSeq,
      result: Promise.resolve({ title: 'Feature 生成标题' }),
    }));
    const commit = vi.fn<ThreadTitleGenerationControl['commit']>(async (threadId, turnId, generation) => {
      const result = await (generation as ThreadTitleGeneration).result;
      if (result?.title) await host.appendTitleUpdate(threadId, turnId, result.title);
    });
    loop.bindThreadTitleGenerationControl({ available: true, start, commit });

    await loop.sendTurn(thread.id, { input: '检查自动标题 Feature 接缝' });

    const events = await threadStore.listEvents(thread.id);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      attachmentCount: 0,
      taskKind: 'regular',
      userContent: '检查自动标题 Feature 接缝',
    }));
    expect(commit).toHaveBeenCalledOnce();
    expect((await threadStore.getThread(thread.id))?.title).toBe('Feature 生成标题');
    expect(publishedEvents).toContain('thread.updated');
    expect(events.findIndex((event) => event.type === 'thread.updated'))
      .toBeLessThan(events.findIndex((event) => event.type === 'turn.completed'));
  });
});

class AnswerModelClient implements ModelClient {
  async *stream(_request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    yield { type: 'text_delta', text: '主回答正常完成' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

async function testDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-title-test-'));
  testDirs.push(dir);
  return dir;
}
