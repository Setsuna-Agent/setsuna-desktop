import { describe, expect, it } from 'vitest';
import type { ModelRequest, ModelStreamEvent, RuntimeToolDefinition, RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { InMemoryApprovalGate } from '../adapters/approval/in-memory-approval-gate.js';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { FileMemoryStore } from '../adapters/store/file-memory-store.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
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
    expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(saved?.messages.find((message) => message.role === 'assistant' && message.toolCalls?.length)?.toolRuns).toMatchObject([
      { id: 'call_1', name: 'workspace_read_file', status: 'success' },
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

    expect(modelClient.requests).toHaveLength(1);
    expect(modelClient.requests[0]).toMatchObject({
      model: 'context-compaction',
      maxOutputTokens: 1600,
      temperature: 0,
      toolChoice: 'none',
    });
    expect(events.some((event) => event.type === 'thread.context_compacting')).toBe(true);
    expect(events.some((event) => event.type === 'thread.context_compacted')).toBe(true);
    expect(compacted.messages[0].contextCompaction?.triggerScopes).toEqual(['manual']);
    expect(compacted.messages[0].content).toContain('模型整理后的上下文摘要');
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
    expect(modelClient.requests.length).toBeGreaterThan(4);
    expect(toolHost.calls).toHaveLength(modelClient.requests.length - 1);
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

class MemoryCapturingModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Remembered.' };
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

class StrictApprovalConfigStore implements ConfigStore {
  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      activeProviderId: 'test',
      providers: [],
      memoryEnabled: true,
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

class ImageCapabilityConfigStore implements ConfigStore {
  constructor(private readonly supportsImages: boolean) {}

  async getConfig() {
    return {
      configPath: '/tmp/config.json',
      dataPath: '/tmp',
      activeProviderId: 'vision-provider',
      providers: [],
      memoryEnabled: true,
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
