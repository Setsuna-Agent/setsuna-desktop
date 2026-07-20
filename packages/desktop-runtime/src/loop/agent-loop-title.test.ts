import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fallbackThreadTitle, type ModelRequest, type ModelStreamEvent, type RuntimeConfigInput, type RuntimeConfigState } from '@setsuna-desktop/contracts';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
import type { ConfigStore, RuntimeProviderConfig } from '../ports/config-store.js';
import type { ModelClient } from '../ports/model-client.js';
import { systemClock } from '../ports/clock.js';
import { AgentLoop } from './agent-loop.js';
import { THREAD_TITLE_GENERATION_MAX_OUTPUT_TOKENS } from './runtime-thread-title-generator.js';

const testDirs: string[] = [];

afterEach(async () => {
  await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('agent loop thread titles', () => {
  it('replaces the first-message fallback with a title from the current model', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await testDataDir(), systemClock, ids);
    const thread = await threadStore.createThread();
    const modelClient = new TitleAwareModelClient();
    const eventBus = new InMemoryEventBus();
    const publishedEvents: string[] = [];
    eventBus.subscribe(thread.id, (event) => publishedEvents.push(event.type));
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus,
      clock: systemClock,
      ids,
      configStore: new TitleConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: '检查为什么对话标题没有经过当前模型生成' });

    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id);
    expect(saved?.title).toBe('恢复模型自动生成标题');
    const titleRequest = modelClient.requests.find((request) => request.model === 'current-model');
    expect(titleRequest?.maxOutputTokens).toBe(THREAD_TITLE_GENERATION_MAX_OUTPUT_TOKENS);
    expect(events.some((event) => event.type === 'thread.updated' && event.payload.title === '恢复模型自动生成标题')).toBe(true);
    expect(publishedEvents).toContain('thread.updated');
    expect(events.findIndex((event) => event.type === 'thread.updated')).toBeLessThan(events.findIndex((event) => event.type === 'turn.completed'));
  });

  it('keeps the deterministic fallback when title generation fails', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await testDataDir(), systemClock, ids);
    const thread = await threadStore.createThread();
    const input = '这是一个很长的首条用户输入，用来确认模型标题生成失败时仍然会保留原来的内容截取逻辑作为稳定兜底，而且不会让整轮回答失败';
    const loop = new AgentLoop({
      threadStore,
      modelClient: new FailingTitleModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new TitleConfigStore(),
    });

    await loop.sendTurn(thread.id, { input });

    const saved = await threadStore.getThread(thread.id);
    expect(saved?.title).toBe(fallbackThreadTitle(input));
    expect(saved?.messages.at(-1)?.content).toBe('主回答正常完成');
  });

  it('does not overwrite a manual rename made while the first turn is running', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await testDataDir(), systemClock, ids);
    const thread = await threadStore.createThread();
    const modelClient = new DelayedTitleModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new TitleConfigStore(),
    });

    const turn = loop.sendTurn(thread.id, { input: '生成一个标题' });
    await modelClient.titleStarted;
    await threadStore.updateThread(thread.id, { title: '用户手动标题' });
    modelClient.releaseTitle();
    await turn;

    expect((await threadStore.getThread(thread.id))?.title).toBe('用户手动标题');
  });
});

class TitleAwareModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'current-model') {
      yield { type: 'text_delta', text: '恢复模型自动生成标题' };
    } else {
      yield { type: 'text_delta', text: '主回答正常完成' };
    }
    yield { type: 'done', finishReason: 'stop' };
  }
}

class FailingTitleModelClient implements ModelClient {
  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    if (request.model === 'current-model') throw new Error('title generation failed');
    yield { type: 'text_delta', text: '主回答正常完成' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class DelayedTitleModelClient implements ModelClient {
  private markTitleStarted: () => void = () => undefined;
  private resolveTitle: () => void = () => undefined;
  readonly titleStarted = new Promise<void>((resolve) => {
    this.markTitleStarted = resolve;
  });
  private readonly titleReleased = new Promise<void>((resolve) => {
    this.resolveTitle = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    if (request.model === 'current-model') {
      this.markTitleStarted();
      await this.titleReleased;
      yield { type: 'text_delta', text: '模型生成标题' };
    } else {
      yield { type: 'text_delta', text: '主回答正常完成' };
    }
    yield { type: 'done', finishReason: 'stop' };
  }

  releaseTitle(): void {
    this.resolveTitle();
  }
}

class TitleConfigStore implements ConfigStore {
  async getConfig(): Promise<RuntimeConfigState> {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'provider',
      providers: [],
      globalPrompt: '',
      memory: {
        useMemories: false,
        generateMemories: false,
        dedicatedTools: false,
        disableOnExternalContext: true,
      },
      memoryEnabled: false,
      setsunaStyle: 'developer',
      approvalPolicy: 'on-request',
      permissionProfile: 'workspace-write',
    };
  }

  async saveConfig(_input: RuntimeConfigInput): Promise<RuntimeConfigState> {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig> {
    const activeModel = {
      id: 'current-model',
      name: 'Current model',
      code: 'current-model',
      enabled: true,
      maxOutputTokens: 4_096,
      thinkingEnabled: false,
      thinkingEfforts: [],
    };
    return {
      id: 'provider',
      name: 'Provider',
      provider: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      enabled: true,
      apiKey: 'test-key',
      models: [activeModel],
      activeModel,
    };
  }
}

async function testDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-title-test-'));
  testDirs.push(dir);
  return dir;
}
