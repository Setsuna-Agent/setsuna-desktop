import { describe, expect, it } from 'vitest';
import type { ModelRequest, ModelStreamEvent, RuntimeEvent, RuntimeToolDefinition, RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { InMemoryApprovalGate } from '../adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { FileMemoryStore } from '../adapters/store/file-memory-store.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
import { MemoryToolHost } from '../adapters/tool/memory-tool-host.js';
import type { ConfigStore, RuntimeProviderConfig } from '../ports/config-store.js';
import type { ModelClient } from '../ports/model-client.js';
import { systemClock } from '../ports/clock.js';
import type { ToolExecutionContext, ToolHost } from '../ports/tool-host.js';
import type { UsageStore } from '../ports/usage-store.js';
import { AgentLoop } from './agent-loop.js';

describe('agent loop tools', () => {
  it('executes model tool calls and continues with tool results', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Tool loop', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const usageStore = new CapturingUsageStore();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      usageStore,
    });

    await loop.sendTurn(thread.id, { input: 'read README' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[0].tools?.[0].name).toBe('workspace_read_file');
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('file contents'))).toBe(true);
    expect(events.some((event) => event.type === 'tool.started' && event.payload.toolName === 'workspace_read_file')).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.status === 'success')).toBe(true);
    const completed = events.find((event): event is Extract<RuntimeEvent, { type: 'tool.completed' }> =>
      event.type === 'tool.completed' && event.payload.toolName === 'workspace_read_file');
    expect(completed?.payload.argumentsPreview).toContain('README.md');
    expect(completed?.payload.durationMs).toEqual(expect.any(Number));
    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(saved?.messages.find((message) => message.role === 'assistant' && message.toolCalls?.length)?.toolRuns).toMatchObject([
      { id: 'call_1', name: 'workspace_read_file', status: 'success', argumentsPreview: expect.stringContaining('README.md'), durationMs: expect.any(Number) },
    ]);
    expect(saved?.messages.find((message) => message.role === 'tool')?.content).toContain('file contents');
    expect(saved?.messages.at(-1)?.content).toContain('I read the file.');
    expect(usageStore.records).toMatchObject([
      {
        threadId: thread.id,
        provider: 'test-provider',
        model: 'test-model',
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      },
    ]);
  });

  it('publishes tool output deltas before completing command tools', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Output delta loop' });
    const loop = new AgentLoop({
      threadStore,
      modelClient: new ShellOutputDeltaModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new OutputDeltaToolHost(),
    });

    await loop.sendTurn(thread.id, { input: 'run command' });
    const events = await threadStore.listEvents(thread.id, 0);
    const deltaIndex = events.findIndex((event) => event.type === 'tool.output_delta');
    const completedIndex = events.findIndex((event) => event.type === 'tool.completed' && event.payload.toolName === 'run_shell_command');

    expect(deltaIndex).toBeGreaterThanOrEqual(0);
    expect(completedIndex).toBeGreaterThan(deltaIndex);
    expect(events[deltaIndex]).toMatchObject({
      type: 'tool.output_delta',
      payload: {
        toolCallId: 'call_shell',
        toolName: 'run_shell_command',
        stream: 'stdout',
        processId: 'shell_test',
        delta: 'streamed output\n',
      },
    });
  });

  it('runs consecutive read-only local tool calls in parallel', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Parallel tools', projectId: 'project_1' });
    const modelClient = new ParallelReadModelClient();
    const toolHost = new ParallelReadToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    const turn = loop.sendTurn(thread.id, { input: 'inspect both' });
    let waitError: unknown;
    try {
      await waitForToolStarts(toolHost, 2);
    } catch (error) {
      waitError = error;
    } finally {
      toolHost.releaseAll();
    }
    await turn;
    if (waitError) throw waitError;

    const saved = await threadStore.getThread(thread.id);
    expect(toolHost.started).toEqual(['read_file', 'search_text']);
    expect(toolHost.contexts.every((context) => context.permissionProfile === 'workspace-write')).toBe(true);
    expect(modelClient.requests).toHaveLength(2);
    expect(saved?.messages.filter((message) => message.role === 'tool').map((message) => message.toolName)).toEqual(['read_file', 'search_text']);
    expect(saved?.messages.at(-1)?.content).toContain('parallel results received');
  });

  it('pauses overlarge local inspection batches after a visible progress note', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Inspection batch', projectId: 'project_1' });
    const modelClient = new OverlargeInspectionModelClient();
    const toolHost = new CountingReadToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'inspect the project' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const assistantWithTools = saved?.messages.find((message) => message.role === 'assistant' && message.toolCalls?.length);
    const secondRequestToolMessages = modelClient.requests[1].messages.filter((message) => message.role === 'tool');

    expect(toolHost.calls).toHaveLength(8);
    expect(toolHost.calls.map((input) => input.file_path)).toEqual([
      'src/file-1.ts',
      'src/file-2.ts',
      'src/file-3.ts',
      'src/file-4.ts',
      'src/file-5.ts',
      'src/file-6.ts',
      'src/file-7.ts',
      'src/file-8.ts',
    ]);
    expect(modelClient.requests).toHaveLength(2);
    expect(assistantWithTools?.content).toContain('第一批关键文件');
    expect(assistantWithTools?.toolCalls).toHaveLength(10);
    expect(assistantWithTools?.toolRuns).toHaveLength(8);
    expect(secondRequestToolMessages).toHaveLength(10);
    expect(secondRequestToolMessages.slice(8).map((message) => message.toolCallId)).toEqual(['call_9', 'call_10']);
    expect(secondRequestToolMessages.slice(8).every((message) => message.content.includes('was not executed'))).toBe(true);
    expect(events.filter((event) => event.type === 'tool.started')).toHaveLength(8);
    expect(events.filter((event) => event.type === 'tool.completed')).toHaveLength(8);
    expect(saved?.messages.at(-1)?.content).toContain('summarized after first batch');
  });

  it('honors a tool host forced tool choice for the next model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Forced tool choice', projectId: 'project_1' });
    const modelClient = new ForcedToolChoiceModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new ForcedToolChoiceHost(),
    });

    await loop.sendTurn(thread.id, { input: 'continue file change' });

    expect(modelClient.requests[0].toolChoice).toEqual({ type: 'tool', name: 'begin_file_change' });
  });

  it('publishes streaming tool-call previews from tool argument deltas', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Tool delta loop', projectId: 'project_1' });
    const modelClient = new ToolDeltaModelClient();
    const toolHost = new PreviewingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'write a file' });
    const events = await threadStore.listEvents(thread.id, 0);
    const saved = await threadStore.getThread(thread.id);
    const runningPreview = events.find((event) =>
      event.type === 'tool.started'
      && event.payload.toolName === 'write_file'
      && event.payload.resultPreview?.includes('src/generated.txt')
    );

    expect(runningPreview).toBeTruthy();
    expect(modelClient.requests[0].messages.map((message) => message.content).join('\n')).toContain('PC local tool prompt');
    expect(saved?.messages.find((message) => message.role === 'assistant' && message.toolRuns?.length)?.toolRuns).toMatchObject([
      {
        id: 'call_delta',
        name: 'write_file',
        status: 'success',
        resultPreview: expect.stringContaining('src/generated.txt'),
      },
    ]);
  });

  it('uses the model client to compact context manually', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Context compaction' });
    for (let index = 0; index < 12; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: `message ${index}`,
            createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new ContextCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const compacted = await loop.compactThreadContext(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const compactingEvent = events.find((event) => event.type === 'thread.context_compacting');
    const compactedEvent = events.find((event) => event.type === 'thread.context_compacted');

    expect(modelClient.requests).toHaveLength(1);
    expect(modelClient.requests[0]).toMatchObject({
      model: 'context-compaction',
      maxOutputTokens: 1600,
      temperature: 0,
      toolChoice: 'none',
    });
    expect(compactingEvent?.turnId).toBeTruthy();
    expect(compactedEvent?.turnId).toBe(compactingEvent?.turnId);
    const compactedSummary = compacted.messages.find((message) => message.contextCompaction);
    expect(compacted.messages.some((message) => message.id === 'msg_0' && message.visibility === 'transcript')).toBe(true);
    expect(compactedSummary?.contextCompaction?.triggerScopes).toEqual(['manual']);
    expect(compactedSummary?.turnId).toBe(compactedEvent?.turnId);
    expect(compactedSummary?.content).toContain('模型整理后的上下文摘要');
  });

  it('automatically compacts oversized context before the next model request', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Automatic context compaction' });
    const oversizedHistory = 'older context '.repeat(90_000);
    for (let index = 0; index < 9; index += 1) {
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'message.created',
        createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
        payload: {
          message: {
            id: `msg_${index}`,
            role: index % 2 ? 'assistant' : 'user',
            content: index === 0 ? oversizedHistory : `recent message ${index}`,
            createdAt: `2026-06-26T00:00:${String(index).padStart(2, '0')}.000Z`,
            status: 'complete',
          },
        },
      });
    }
    const modelClient = new AutoCompactionModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.sendTurn(thread.id, { input: 'continue after history' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const compactedEvent = events.find((event) => event.type === 'thread.context_compacted' && event.turnId);
    const mainRequest = modelClient.requests.find((request) => request.model === 'local-runtime-smoke');

    expect(modelClient.requests.map((request) => request.model)).toEqual(['context-compaction', 'local-runtime-smoke']);
    expect(events.some((event) => event.type === 'thread.context_compacting' && event.turnId)).toBe(true);
    expect(compactedEvent?.turnId).toBeTruthy();
    const savedCompactionSummary = saved?.messages.find((message) => message.contextCompaction);
    expect(saved?.messages.some((message) => message.id === 'msg_0' && message.visibility === 'transcript')).toBe(true);
    expect(savedCompactionSummary?.turnId).toBe(compactedEvent?.turnId);
    expect(savedCompactionSummary?.contextCompaction?.triggerScopes).toEqual(['total']);
    expect(savedCompactionSummary?.content).toContain('<context_compaction_summary');
    expect(saved?.messages.some((message) => message.content === 'continue after history')).toBe(true);
    expect(mainRequest?.messages.some((message) => message.contextCompaction?.triggerScopes?.includes('total'))).toBe(true);
    expect(mainRequest?.messages.map((message) => message.content).join('\n')).not.toContain(oversizedHistory.slice(0, 200));
  });

  it('forces a final no-tool response when the tool loop reaches its round limit', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Tool loop limit', projectId: 'project_1' });
    const modelClient = new ToolLoopLimitModelClient();
    const toolHost = new CapturingToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });

    await loop.sendTurn(thread.id, { input: 'keep inspecting files' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    expect(events.some((event) => event.type === 'turn.completed')).toBe(true);
    expect(modelClient.requests.at(-1)?.toolChoice).toBe('none');
    expect(modelClient.requests).toHaveLength(201);
    expect(toolHost.calls).toHaveLength(200);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.status === 'error'
      && event.payload.content.includes('budget')
    )).toBe(false);
    expect(saved?.messages.at(-1)?.content).toBe('Final answer after the available tool results.');
    expect(saved?.messages.at(-1)?.status).toBe('complete');
  });

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

    expect(modelClient.requests[0].messages[0]).toMatchObject({ role: 'system' });
    expect(modelClient.requests[0].messages[0].content).toContain('<memory_context>');
    expect(modelClient.requests[0].messages[0].content).toContain('local-only runtime answers');
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

  it('passes per-turn thinking options and stores reasoning deltas', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Thinking loop' });
    const modelClient = new ReasoningModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.sendTurn(thread.id, { input: 'think first', thinking: true, thinkingEffort: 'max' });
    const saved = await threadStore.getThread(thread.id);

    expect(modelClient.requests[0]).toMatchObject({ thinking: true, reasoningEffort: 'max' });
    expect(saved?.messages.find((message) => message.role === 'assistant')?.content).toBe('<think>plan</think>answer');
  });

  it('rejects image attachments when the active model does not support image input', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Image support' });
    const modelClient = new ToolCallingModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      configStore: new ImageCapabilityConfigStore(false),
    });

    await expect(loop.sendTurn(thread.id, {
      input: 'look at this',
      attachments: [
        {
          id: 'image_1',
          name: 'diagram.png',
          type: 'image/png',
          size: 12,
          url: 'data:image/png;base64,aW1hZ2U=',
        },
      ],
    })).rejects.toThrow('当前模型未启用图片输入。');

    expect(modelClient.requests).toHaveLength(0);
  });

  it('pauses tool execution until approval is answered', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Approval loop' });
    const modelClient = new ApprovalToolModelClient();
    const toolHost = new ApprovalToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'run risky tool' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(toolHost.calls).toEqual([]);
    expect(pendingApproval.toolName).toBe('dangerous_tool');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;
    const events = await threadStore.listEvents(thread.id, 0);

    expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('approved result'))).toBe(true);
    const startedIndex = events.findIndex((event) => event.type === 'tool.started' && event.payload.toolName === 'dangerous_tool');
    const approvalIndex = events.findIndex((event) => event.type === 'approval.requested');
    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(approvalIndex).toBeGreaterThanOrEqual(0);
    expect(startedIndex).toBeLessThan(approvalIndex);
    expect(events.some((event) => event.type === 'approval.requested')).toBe(true);
    expect(events.some((event) => event.type === 'tool.completed' && event.payload.status === 'success')).toBe(true);
  });

  it('requires approval for every tool when approval policy is strict', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Strict approval loop', projectId: 'project_1' });
    const modelClient = new ToolCallingModelClient();
    const toolHost = new CapturingToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    const pendingTurn = loop.sendTurn(thread.id, { input: 'read README strictly' });
    const pendingApproval = await waitForPendingApproval(approvalGate);

    expect(toolHost.calls).toEqual([]);
    expect(pendingApproval.toolName).toBe('workspace_read_file');
    expect(pendingApproval.reason).toContain('Strict approval policy');

    await approvalGate.answerApproval(pendingApproval.id, { decision: 'approve' });
    await pendingTurn;

    expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
  });

  it('skips file mutation approvals even when approval policy is strict', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Strict file write loop' });
    const modelClient = new ToolDeltaModelClient();
    const toolHost = new PreviewingToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new StrictApprovalConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: 'write file strictly' });
    const events = await threadStore.listEvents(thread.id, 0);
    const approvals = await approvalGate.listApprovals();

    expect(approvals.approvals).toEqual([]);
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
    expect(events.some((event) =>
      event.type === 'tool.completed'
      && event.payload.toolName === 'write_file'
      && event.payload.status === 'success'
    )).toBe(true);
  });

  it('skips tool approvals when approval policy is full', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Full approval loop' });
    const modelClient = new ApprovalToolModelClient();
    const toolHost = new ApprovalToolHost();
    const approvalGate = new InMemoryApprovalGate(systemClock, ids);
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      approvalGate,
      configStore: new FullApprovalConfigStore(),
    });

    await loop.sendTurn(thread.id, { input: 'run risky tool without confirmation' });
    const events = await threadStore.listEvents(thread.id, 0);
    const approvals = await approvalGate.listApprovals();

    expect(approvals.approvals).toEqual([]);
    expect(toolHost.calls).toEqual([{ name: 'dangerous_tool', input: { value: 42 } }]);
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
  });

  it('cancels active turns without publishing runtime errors', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Cancel loop' });
    const modelClient = new CancellableModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    const started = await loop.startTurn(thread.id, { input: 'keep going until cancelled' });
    await waitForModelRequest(modelClient);

    await expect(loop.cancelTurn(thread.id, started.turnId)).resolves.toBe(true);
    const events = await waitForTurnCancelled(threadStore, thread.id);
    const saved = await threadStore.getThread(thread.id);

    expect(modelClient.aborted).toBe(true);
    expect(events.some((event) => event.type === 'turn.cancelled' && event.turnId === started.turnId)).toBe(true);
    expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    expect(saved?.messages.at(-1)?.status).toBe('complete');
  });

  it('edits a user message, truncates following replies, and regenerates without duplicating the user turn', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Regenerate loop' });
    const modelClient = new RegenerateModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.sendTurn(thread.id, { input: 'original prompt' });
    const firstSaved = await threadStore.getThread(thread.id);
    const userMessageId = firstSaved?.messages.find((message) => message.role === 'user')?.id;
    if (!userMessageId) throw new Error('Expected a user message to regenerate.');

    const regenerated = await loop.regenerateFromMessage(thread.id, userMessageId, { content: 'edited prompt' });
    await waitForTurnCompleted(threadStore, thread.id, regenerated.turnId);
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);

    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(saved?.messages[0]).toMatchObject({ id: userMessageId, content: 'edited prompt' });
    expect(saved?.messages[1]?.content).toBe('answer 2');
    expect(modelClient.requests[1].messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
      'edited prompt',
    ]);
    expect(events.some((event) => event.type === 'message.updated')).toBe(true);
    expect(events.some((event) => event.type === 'messages.truncated')).toBe(true);
    expect(events.filter((event) => event.type === 'message.created' && event.payload.message.role === 'user')).toHaveLength(1);
  });
});

class ToolCallingModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'I read the file.' };
    yield {
      type: 'usage',
      usage: {
        provider: 'test-provider',
        model: 'test-model',
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
      },
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ShellOutputDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_shell', name: 'run_shell_command', arguments: '{"command":"echo streamed","risk_level":"low"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'saw output' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ParallelReadModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          { id: 'call_read', name: 'read_file', arguments: '{"file_path":"README.md"}' },
          { id: 'call_search', name: 'search_text', arguments: '{"query":"needle"}' },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'parallel results received' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class OverlargeInspectionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: Array.from({ length: 10 }, (_, index) => ({
          id: `call_${index + 1}`,
          name: 'read_file',
          arguments: JSON.stringify({ file_path: `src/file-${index + 1}.ts` }),
        })),
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'summarized after first batch' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ForcedToolChoiceModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'forced choice observed' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ToolDeltaModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'tool_call_delta', call: { id: 'call_delta', name: 'write_file', argumentsDelta: '{"file_path":"src/generated.txt",' } };
      yield { type: 'tool_call_delta', call: { id: 'call_delta', name: 'write_file', argumentsDelta: '"content":"generated\\n"}' } };
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_delta', name: 'write_file', arguments: '{"file_path":"src/generated.txt","content":"generated\\n"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ToolLoopLimitModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.toolChoice === 'none' || !request.tools?.length) {
      yield { type: 'text_delta', text: 'Final answer after the available tool results.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield {
      type: 'tool_calls',
      toolCalls: [{ id: `call_${this.requests.length}`, name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
    };
    yield { type: 'done', finishReason: 'tool_calls' };
  }
}

class ContextCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield {
      type: 'text_delta',
      text: JSON.stringify({
        summary: '模型整理后的上下文摘要',
        important_constraints: ['只保留关键历史'],
        open_items: ['继续当前任务'],
        already_said: '已说明实现方向',
        tool_context: '没有额外工具上下文',
      }),
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class AutoCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'context-compaction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          summary: 'Automatic summary for oversized history.',
          important_constraints: ['Keep the current task.'],
          open_items: ['Continue the turn.'],
          already_said: 'Older history was summarized.',
          tool_context: 'No active tool context.',
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Final answer after automatic compaction.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class CapturingToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown; projectId?: string }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'workspace_read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ];
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    return { content: 'file contents from tool' };
  }
}

class OutputDeltaToolHost implements ToolHost {
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'run_shell_command',
        description: 'Run a command',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' }, risk_level: { type: 'string' } },
          required: ['command', 'risk_level'],
        },
      },
    ];
  }

  async runTool(_name: string, _input: unknown, context: ToolExecutionContext) {
    context.onToolOutputDelta?.({
      delta: 'streamed output\n',
      stream: 'stdout',
      processId: 'shell_test',
    });
    return {
      content: 'command completed',
      data: { process_id: 'shell_test', command: 'echo streamed', exit_code: 0 },
    };
  }
}

class ParallelReadToolHost implements ToolHost {
  readonly started: string[] = [];
  readonly contexts: ToolExecutionContext[] = [];
  private readonly blocker: Promise<void>;
  private releaseBlocker: () => void = () => undefined;

  constructor() {
    this.blocker = new Promise<void>((resolve) => {
      this.releaseBlocker = resolve;
    });
  }

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
      {
        name: 'search_text',
        description: 'Search text',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];
  }

  async runTool(name: string, _input: unknown, context: ToolExecutionContext) {
    this.started.push(name);
    this.contexts.push(context);
    await this.blocker;
    return { content: `${name} result` };
  }

  releaseAll(): void {
    this.releaseBlocker();
  }
}

class CountingReadToolHost implements ToolHost {
  readonly calls: Array<{ file_path?: unknown }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    ];
  }

  async runTool(_name: string, input: unknown) {
    const parsed = input && typeof input === 'object' && !Array.isArray(input) ? input as { file_path?: unknown } : {};
    this.calls.push(parsed);
    return { content: `contents for ${String(parsed.file_path ?? 'unknown')}` };
  }
}

class ForcedToolChoiceHost implements ToolHost {
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'begin_file_change',
        description: 'Begin a file change',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
    ];
  }

  toolChoice() {
    return { type: 'tool' as const, name: 'begin_file_change' };
  }

  async runTool() {
    return { content: 'unused' };
  }
}

class PreviewingToolHost implements ToolHost {
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: {
          type: 'object',
          properties: { file_path: { type: 'string' }, content: { type: 'string' } },
          required: ['file_path', 'content'],
        },
      },
    ];
  }

  systemPrompt() {
    return 'PC local tool prompt';
  }

  async previewPartialToolCall(_name: string, rawArguments: string) {
    if (!rawArguments.includes('src/generated.txt')) return null;
    return filePreview();
  }

  async previewToolCall() {
    return filePreview();
  }

  async runTool() {
    return { content: 'wrote file', preview: filePreview().resultPreview };
  }
}

function filePreview() {
  return {
    argumentsPreview: JSON.stringify({ file_path: 'src/generated.txt' }),
    resultPreview: JSON.stringify({
      diff: {
        path: 'src/generated.txt',
        action: 'create',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [],
      },
    }),
  };
}

class MemoryCapturingModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Remembered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RememberMemoryToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          {
            id: 'call_memory',
            name: 'remember_memory',
            arguments: JSON.stringify({ content: '这个项目用 pnpm 管理依赖。', scope: 'project' }),
          },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Saved.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class PassiveMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          memories: [
            {
              content: '用户要求记忆生成模型要跟随当前切换的模型。',
              title: '记忆模型',
              scope: 'project',
              tags: ['memory', 'model'],
            },
          ],
        }),
      };
      yield {
        type: 'usage',
        usage: {
          provider: 'test-provider',
          model: 'selected-model',
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
        },
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    yield { type: 'text_delta', text: 'Done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ActiveMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          memories: [
            {
              content: '用户偏好当前仓库样式尽量使用 UnoCSS。',
              title: '仓库样式',
              scope: 'project',
            },
          ],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [
          {
            id: 'call_memory',
            name: 'remember_memory',
            arguments: JSON.stringify({
              content: '当前仓库的样式需要尽可能使用 UnoCSS。',
              scope: 'project',
            }),
          },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: '已记录到项目级记忆中。' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class RegenerateModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: `answer ${this.requests.length}` };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ReasoningModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'reasoning_delta', text: 'plan' };
    yield { type: 'text_delta', text: 'answer' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ApprovalToolModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_approval', name: 'dangerous_tool', arguments: '{"value":42}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The approved tool ran.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class CancellableModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  aborted = false;

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'partial response' };
    await new Promise<void>((resolve) => {
      const signal = request.signal;
      if (!signal) {
        resolve();
        return;
      }
      if (signal.aborted) {
        this.aborted = true;
        resolve();
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          this.aborted = true;
          resolve();
        },
        { once: true },
      );
    });
    request.signal?.throwIfAborted();
    yield { type: 'text_delta', text: ' should not appear' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ApprovalToolHost implements ToolHost {
  calls: Array<{ name: string; input: unknown }> = [];

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'dangerous_tool',
        description: 'A tool requiring user approval',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      },
    ];
  }

  async approvalForTool(name: string, input: unknown) {
    return name === 'dangerous_tool'
      ? {
          reason: 'This tool changes local state.',
          argumentsPreview: JSON.stringify(input),
        }
      : null;
  }

  async runTool(name: string, input: unknown) {
    this.calls.push({ name, input });
    return { content: 'approved result' };
  }
}

class CapturingUsageStore implements UsageStore {
  records: RuntimeUsageRecord[] = [];

  async recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<RuntimeUsageRecord> {
    const record = { id: `usage_${this.records.length + 1}`, ...input };
    this.records.push(record);
    return record;
  }

  async getUsage() {
    return {
      records: this.records,
      summary: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        recordCount: this.records.length,
        byProvider: [],
        byModel: [],
      },
    };
  }
}

class PersonalizationConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: 'Prefer crisp context before the answer.',
      memoryEnabled: false,
      setsunaStyle: 'daily' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class StrictApprovalConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'strict' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class FullApprovalConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'test',
      providers: [],
      globalPrompt: '',
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'full' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return null;
  }
}

class ImageCapabilityConfigStore implements ConfigStore {
  constructor(private readonly supportsImages: boolean) {}

  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      storagePath: '/tmp/memories',
      activeProviderId: 'vision-provider',
      providers: [],
      globalPrompt: '',
      memoryEnabled: true,
      setsunaStyle: 'developer' as const,
      approvalPolicy: 'on-request' as const,
      permissionProfile: 'workspace-write' as const,
    };
  }

  async saveConfig() {
    return this.getConfig();
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    const model = {
      id: 'vision-model',
      name: 'Vision model',
      code: 'vision-model',
      enabled: true,
      maxOutputTokens: 1000,
      thinkingEnabled: false,
      thinkingEfforts: [],
      supportsImages: this.supportsImages,
    };
    return {
      id: 'vision-provider',
      name: 'Vision provider',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      enabled: true,
      apiKey: '',
      models: [model],
      activeModel: model,
    };
  }
}

async function mkDataDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  return mkdtemp(path.join(tmpdir(), 'setsuna-agent-loop-tools-'));
}

async function waitForPendingApproval(approvalGate: InMemoryApprovalGate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const approvals = await approvalGate.listApprovals();
    const pending = approvals.approvals.find((approval) => approval.status === 'pending');
    if (pending) return pending;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for approval');
}

async function waitForModelRequest(modelClient: CancellableModelClient) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (modelClient.requests.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for model request');
}

async function waitForToolStarts(toolHost: ParallelReadToolHost, count: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (toolHost.started.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${count} parallel tool starts; saw ${toolHost.started.length}.`);
}

async function waitForTurnCancelled(threadStore: JsonThreadStore, threadId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await threadStore.listEvents(threadId, 0);
    if (events.some((event) => event.type === 'turn.cancelled')) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for turn cancellation');
}

async function waitForTurnCompleted(threadStore: JsonThreadStore, threadId: string, turnId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await threadStore.listEvents(threadId, 0);
    if (events.some((event) => event.type === 'turn.completed' && event.turnId === turnId)) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for turn completion');
}
