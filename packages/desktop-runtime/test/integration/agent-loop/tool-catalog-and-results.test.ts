import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeMessage,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import { pluginAppMentionText, pluginMentionText } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileToolResultStore } from '../../../src/adapters/store/file-tool-result-store.js';
import { RuntimeApiToolHost } from '../../../src/adapters/tool/runtime-api-tool-host.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { systemClock } from '../../../src/ports/clock.js';
import type {
  ToolExecutionContext,
  ToolHost,
} from '../../../src/ports/tool-host.js';
import { CapturingToolHost, ContextWindowConfigStore, mkDataDir, SingleToolCallModelClient } from '../../support/agent-loop/shared.js';
import { installedAppBuilder } from '../../support/app-builder.js';
import { createTestThreadStore } from '../../support/thread-store.js';

describe('agent loop tool catalog and stored results', () => {
  it.each(['builder', 'app'] as const)('loads authoring tools for a %s reference on the first model step and persists ownership in a projectless chat', async (referenceKind) => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Build an app' });
    const builder = installedAppBuilder();
    const app = { ...builder, id: 'my-table', name: 'My table', skills: [], tools: [],
      extension: { apiVersion: 1 as const, runtime: 'node-worker' as const, capabilities: ['ui' as const], trust: 'trusted' as const,
        rendererUi: { schemaVersion: 2 as const, actions: [], contributions: [{ id: 'table.page', slot: 'renderer.plugin.page' as const,
          navigation: { label: 'My table' }, document: { htmlResourceId: 'html', actionIds: [] } }] } } };
    const pluginStore = { listPlugins: async () => ({ plugins: [builder, app] }) };
    const modelClient = new SingleToolCallModelClient({
      id: 'read_projects', name: 'read_runtime_api', arguments: '{"path":"/v1/projects"}',
    });
    const toolHost = new RuntimeApiToolHost({
      request: async () => ({ ok: true, status: 200, data: { projects: [] } }),
    }, pluginStore);
    const loop = new AgentLoop({
      threadStore, modelClient, pluginStore, toolHost, eventBus: new InMemoryEventBus(), clock: systemClock, ids,
    });
    const reference = referenceKind === 'builder' ? pluginMentionText(builder)
      : pluginAppMentionText({ pluginId: app.id, contributionId: 'table.page', name: app.name });
    await loop.sendTurn(thread.id, { input: `${reference} Show my projects in this app.` });
    expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toContain('read_runtime_api');
    expect(modelClient.requests[0].messages.map((message) => message.content).join('\n'))
      .toContain('"availableTools":["read_runtime_api"]');
    const events = await threadStore.listEvents(thread.id, 0);
    expect(events.find((event) => event.type === 'tool.started')?.payload).toMatchObject({
      toolName: 'read_runtime_api', plugin: { id: builder.id, name: builder.name, icon: builder.icon },
    });
    const saved = await threadStore.getThread(thread.id);
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? [])).toMatchObject([{
      name: 'read_runtime_api', status: 'success', plugin: { id: builder.id, name: builder.name },
    }]);
  });

  it('discovers an MCP tool, advertises its schema on the next step, and executes through the host', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'MCP discovery' });
    const requests: ModelRequest[] = [];
    const hostCalls: string[] = [];
    const tool: RuntimeToolDefinition = {
      name: 'mcp__docs__search', description: 'Search documents',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      source: { kind: 'mcp', id: 'docs', name: 'Document service' },
    };
    const modelClient: ModelClient = { stream: async function* (request) {
      requests.push(request);
      if (requests.length <= 2) {
        yield { type: 'tool_calls', toolCalls: [{ id: `call_${requests.length}`, name: requests.length === 1 ? 'search_tools' : tool.name, arguments: '{"query":"Notebook"}' }] };
        yield { type: 'done', finishReason: 'tool_calls' };
      } else {
        yield { type: 'text_delta', text: 'Found the requested document.' };
        yield { type: 'done', finishReason: 'stop' };
      }
    } };
    const loop = new AgentLoop({ threadStore, modelClient, eventBus: new InMemoryEventBus(), clock: systemClock, ids,
      pluginStore: { listPlugins: async () => ({ plugins: [{
        id: 'notebook', name: 'Notebook', description: 'Find shared knowledge', installedAt: '',
        skills: [], hooks: [], hookCount: 0, resources: [],
        mcpServers: [{ key: 'docs', label: 'Document service', owned: true, transport: 'streamableHttp' }],
      }] }) },
      toolHost: { listTools: async () => [tool], runTool: async (name) => { hostCalls.push(name); return { content: 'Requested document.' }; } },
    });
    await loop.sendTurn(thread.id, { input: 'Find my document.' });
    expect(requests[0]?.tools?.map((item) => item.name)).toContain('search_tools');
    expect(requests[0]?.tools?.map((item) => item.name)).not.toContain(tool.name);
    expect(requests[0]?.tools?.find((item) => item.name === 'search_tools')?.description).toContain('Notebook');
    const definition = { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
    expect(requests[1]?.tools).toContainEqual(definition);
    expect(requests[2]?.tools).toContainEqual(definition);
    expect(hostCalls).toEqual([tool.name]);
    expect((await threadStore.getThread(thread.id))?.messages.at(-1)?.content).toBe('Found the requested document.');
  });
  it('persists CLI plugin attribution while preserving host name ownership', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Tool catalog routing' });
    const modelClient = new CatalogToolCallModelClient();
    const toolHost = new ShellToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
      pluginStore: { listPlugins: async () => ({ plugins: [{
        id: 'github', name: 'GitHub', installedAt: '', skills: [], hooks: [], hookCount: 0, resources: [], mcpServers: [],
        connectors: [{ id: 'cli', name: 'GitHub CLI', kind: 'cli', command: 'gh', required: false,
          installUrl: 'https://cli.github.com', setupCommands: [] }],
      }] }) },
    });
    loop.registerAppServerDynamicTools(thread.id, [{
      name: 'run_shell_command',
      namespace: 'collision',
      toolName: 'run_shell_command',
      description: 'Dynamic tool that must not replace the host tool.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    }], 'dynamic-connection-1');

    await loop.sendTurn(thread.id, { input: 'run the command' });
    const saved = await threadStore.getThread(thread.id);
    const shellMessages = saved?.messages.filter((message) => (
      message.role === 'tool' && message.toolName === 'run_shell_command'
    )) ?? [];

    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[0].tools?.map((tool) => tool.name))
      .toContain('run_shell_command');
    expect(toolHost.calls).toEqual([{ command: 'gh pr list' }]);
    expect(shellMessages).toHaveLength(1);
    expect(shellMessages[0]?.content).toBe('command output');
    const events = await threadStore.listEvents(thread.id, 0);
    expect(events.find((event) => event.type === 'tool.started')?.payload).toMatchObject({
      toolName: 'run_shell_command', plugin: { id: 'github', name: 'GitHub' },
    });
    expect(saved?.messages.flatMap((message) => message.toolRuns ?? [])).toMatchObject([{
      name: 'run_shell_command', status: 'success', plugin: { id: 'github', name: 'GitHub' },
    }]);
  });

  it('recovers a stored result page by page without re-truncating read_tool_result output', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = createTestThreadStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Stored result pagination' });
    const original = '0123456789abcdef'.repeat(3_000);
    const toolResultStore = new FileToolResultStore(dataDir);
    await toolResultStore.save({
      resultId: 'tool_result_pagination',
      threadId: thread.id,
      toolCallId: 'call_original',
      toolName: 'run_shell_command',
      fullText: original,
      originalEstimatedTokens: 12_000,
      visibleTokenLimit: 8_000,
      locallyTruncated: false,
    });
    const modelClient = new PaginationRecoveryModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new CapturingToolHost(),
      toolResultStore,
    });

    await loop.sendTurn(thread.id, { input: 'recover the whole stored result' });
    const saved = await threadStore.getThread(thread.id);
    const pages = saved?.messages.filter((message) => (
      message.role === 'tool' && message.toolName === 'read_tool_result'
    )) ?? [];

    expect(modelClient.requests).toHaveLength(3);
    expect(pages).toHaveLength(2);
    expect(pages.every((message) => !message.content.includes('Warning: tool output was truncated.'))).toBe(true);
    expect(pages.every((message) => message.toolResultRef === undefined)).toBe(true);
    expect(pages.map(pageContent).join('')).toBe(original);
  });

  it.each(['projection', 'compaction'] as const)('preserves original evidence after %s and subsequent quota eviction', async mode => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = createTestThreadStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Evicted working-set evidence' });
    const resultBytes = mode === 'compaction' ? 32_000 : 16_000;
    const toolResultStore = new FileToolResultStore(dataDir, resultBytes, 12 * resultBytes);
    const originals: RuntimeMessage[] = [];
    for (let index = 0; index < 12; index++) {
      const resultId = `result_${String(index).padStart(2, '0')}`;
      const call = { id: `history_call_${index}`, name: 'read_file', arguments: '{}' };
      const content = `Historical evidence ${index}: `.padEnd(resultBytes, 'x');
      await toolResultStore.save({ resultId, threadId: thread.id, toolCallId: call.id, toolName: call.name,
        fullText: content, originalEstimatedTokens: resultBytes / 4, visibleTokenLimit: 8000, locallyTruncated: false });
      const message: RuntimeMessage = { id: `history_result_${index}`, role: 'tool', toolCallId: call.id, toolName: call.name,
        content, status: 'complete', createdAt: thread.createdAt,
        toolResultRef: { resultId, originalEstimatedTokens: resultBytes / 4, visibleTokens: resultBytes / 4, visibleTokenLimit: 8000 } };
      originals.push(message);
      const pair: RuntimeMessage[] = [{ id: `history_assistant_${index}`, role: 'assistant', content: '',
        status: 'complete', createdAt: thread.createdAt, toolCalls: [call] }, message];
      for (const entry of pair) await threadStore.appendEvent(thread.id, {
        id: ids.id('event'), threadId: thread.id, type: 'message.created', createdAt: entry.createdAt, payload: { message: entry },
      });
    }
    const requests: ModelRequest[] = [];
    const compactionRequests: ModelRequest[] = [];
    const loop = new AgentLoop({ ids, threadStore, toolResultStore, clock: systemClock, eventBus: new InMemoryEventBus(),
      configStore: mode === 'compaction' ? new ContextWindowConfigStore(32_000) : undefined,
      toolHost: { listTools: async () => [{ name: 'read_file', description: 'Read evidence', inputSchema: { type: 'object' } }],
        runTool: async () => ({ content: 'New evidence: '.padEnd(resultBytes, 'y') }) },
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        if (request.messages.some(message => message.id === 'context_compaction_system')) {
          compactionRequests.push(request);
          yield { type: 'text_delta', text: JSON.stringify({ summary: 'Historical evidence inspected.', decisions: [], open_items: ['Compare the next observation.'] }) };
          yield { type: 'done', finishReason: 'stop' };
          return;
        }
        requests.push(request);
        if (requests.length === 1) {
          yield { type: 'tool_calls', toolCalls: [{ id: 'new_evidence', name: 'read_file', arguments: '{}' }] };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Evidence retained.' };
          yield { type: 'done', finishReason: 'stop' };
        }
      } },
    });
    await loop.sendTurn(thread.id, { input: 'Inspect one more result and compare it with the earliest evidence.' });
    expect(requests).toHaveLength(2);
    expect(await toolResultStore.read(thread.id, 'result_00', 0, 1)).toBeNull();
    if (mode === 'projection') {
      expect(requests[0].messages.find(message => message.id === originals[0].id)?.content).toContain('[Stored tool observation]');
      expect(requests[1].messages.find(message => message.id === originals[0].id)).toMatchObject(originals[0]);
    } else {
      expect(compactionRequests.some(request => request.messages.some(message => message.content.includes('[Stored tool observation]')))).toBe(true);
      const compactions = (await threadStore.listEvents(thread.id)).filter(event => event.type === 'thread.context_compacted');
      expect(compactions.length).toBeGreaterThan(0);
      for (const event of compactions) {
        expect(event.payload.messages.find(message => message.id === originals[0].id)).toMatchObject(originals[0]);
      }
    }
    await loop.shutdown();
    await threadStore.close();
    const restoredStore = createTestThreadStore(dataDir, systemClock, ids);
    const saved = await restoredStore.getThread(thread.id);
    for (const original of originals) expect(saved?.messages.find(message => message.id === original.id)).toMatchObject(original);
  });

  it('persists current-turn evidence during compaction even when sampling snapshots cannot be read', async () => {
    const ids = new RandomIdGenerator();
    const dataDir = await mkDataDir();
    const threadStore = createTestThreadStore(dataDir, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Current-turn evidence' });
    threadStore.getSamplingState = async () => { throw new Error('Sampling snapshot unavailable'); };
    const originals = Array.from({ length: 12 }, (_, index) => `Current evidence ${index}: `.padEnd(32_000, 'x'));
    let step = 0;
    let sawProjectedCompaction = false;
    const loop = new AgentLoop({ ids, threadStore, clock: systemClock, eventBus: new InMemoryEventBus(),
      configStore: new ContextWindowConfigStore(32_000), toolResultStore: new FileToolResultStore(dataDir),
      toolHost: { listTools: async () => [{ name: 'read_file', description: 'Read evidence', inputSchema: { type: 'object' } }],
        runTool: async (_name, args) => ({ content: originals[(args as { index: number }).index] }) },
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        if (request.messages.some(message => message.id === 'context_compaction_system')) {
          sawProjectedCompaction ||= request.messages.some(message => message.content.includes('[Stored tool observation]'));
          yield { type: 'text_delta', text: JSON.stringify({ summary: 'Inspected the requested evidence.', decisions: [], open_items: [] }) };
          yield { type: 'done', finishReason: 'stop' };
        } else if (++step === 1) {
          yield { type: 'tool_calls', toolCalls: originals.map((_content, index) => ({
            id: `call_${index}`, name: 'read_file', arguments: JSON.stringify({ index }),
          })) };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text_delta', text: 'Evidence inspected.' };
          yield { type: 'done', finishReason: 'stop' };
        }
      } },
    });
    try {
      await loop.sendTurn(thread.id, { input: 'Inspect all requested evidence.' });
    } finally {
      await loop.shutdown();
    }
    expect(sawProjectedCompaction).toBe(true);
    const compactions = (await threadStore.listEvents(thread.id)).filter(event => event.type === 'thread.context_compacted');
    expect(compactions.length).toBeGreaterThan(0);
    const saved = await threadStore.getThread(thread.id);
    for (const [index, content] of originals.entries()) {
      expect(compactions.at(-1)?.payload.messages.find(message => message.toolCallId === `call_${index}`)?.content).toBe(content);
      expect(saved?.messages.find(message => message.toolCallId === `call_${index}`)?.content).toBe(content);
    }
  });
});

class CatalogToolCallModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_shell',
          name: 'run_shell_command',
          arguments: JSON.stringify({ command: 'gh pr list' }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Command completed.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class PaginationRecoveryModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    const previousPage = [...request.messages].reverse().find((message) => (
      message.role === 'tool' && message.toolName === 'read_tool_result'
    ));
    const nextOffset = previousPage?.content.match(/next_offset: (\d+)/u)?.[1];
    if (!previousPage || nextOffset) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: `call_read_page_${this.requests.length}`,
          name: 'read_tool_result',
          arguments: JSON.stringify({
            result_id: 'tool_result_pagination',
            offset: nextOffset ? Number(nextOffset) : 0,
          }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Stored result recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class ShellToolHost implements ToolHost {
  readonly calls: Array<{ command: string }> = [];

  async listTools(): Promise<RuntimeToolDefinition[]> {
    return [{
      name: 'run_shell_command',
      description: 'Run a shell command.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    }];
  }

  async runTool(_name: string, input: unknown, _context: ToolExecutionContext) {
    this.calls.push(input as { command: string });
    return { content: 'command output' };
  }
}

function pageContent(message: { content: string }): string {
  const separator = message.content.indexOf('\n\n');
  return separator >= 0 ? message.content.slice(separator + 2) : '';
}
