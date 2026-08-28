import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { FileToolResultStore } from '../../../src/adapters/store/file-tool-result-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { systemClock } from '../../../src/ports/clock.js';
import type {
  ToolExecutionContext,
  ToolHost,
} from '../../../src/ports/tool-host.js';
import { CapturingToolHost, mkDataDir } from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';

describe('agent loop deferred tools and stored results', () => {
  it('executes at most one tool search from the same sampling step', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Duplicate deferred search' });
    const modelClient = new DuplicateToolSearchModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost: new DeferredShellToolHost(),
    });

    await loop.sendTurn(thread.id, { input: 'find the relevant deferred tool' });
    const saved = await threadStore.getThread(thread.id);
    const events = await threadStore.listEvents(thread.id, 0);
    const searchedAssistant = saved?.messages.find((message) => (
      message.role === 'assistant' && message.toolCalls?.some((call) => call.name === 'tool_search')
    ));
    const replay = searchedAssistant?.providerMetadata?.assistantReplay;

    expect(searchedAssistant?.toolCalls).toEqual([{
      id: 'search_1',
      name: 'tool_search',
      arguments: '{"query":"shell command"}',
    }]);
    expect(saved?.messages.filter((message) => message.role === 'tool' && message.toolName === 'tool_search'))
      .toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.completed' && event.payload.toolName === 'tool_search'))
      .toHaveLength(1);
    expect(events.some((event) => (
      (event.type === 'item.started' || event.type === 'item.completed')
      && (event.payload.item.id === 'pi_search_2' || event.payload.item.toolCall?.id === 'search_2')
    ))).toBe(false);
    expect(saved?.turns?.flatMap((turn) => turn.items).some((item) => (
      item.id === 'pi_search_2' || item.toolCall?.id === 'search_2'
    )))
      .toBe(false);
    expect(replay?.responseId).toBeUndefined();
    expect(replay?.blocks.filter((block) => block.type === 'tool_call')).toEqual([{
      type: 'tool_call',
      id: 'search_1',
      name: 'tool_search',
      arguments: { query: 'shell command' },
    }]);
  });

  it('executes an omitted deferred host tool and preserves host name ownership', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Deferred tool routing' });
    const modelClient = new DeferredFirstCallModelClient();
    const toolHost = new DeferredShellToolHost();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
      toolHost,
    });
    loop.registerAppServerDynamicTools(thread.id, [{
      name: 'run_shell_command',
      namespace: 'collision',
      toolName: 'run_shell_command',
      description: 'Dynamic tool that must not replace the deferred host tool.',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    }], 'dynamic-connection-1');

    await loop.sendTurn(thread.id, { input: 'run the deferred command' });
    const saved = await threadStore.getThread(thread.id);
    const shellMessages = saved?.messages.filter((message) => (
      message.role === 'tool' && message.toolName === 'run_shell_command'
    )) ?? [];

    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[0].tools?.map((tool) => tool.name))
      .not.toContain('run_shell_command');
    expect(toolHost.calls).toEqual([{ command: 'printf direct-deferred' }]);
    expect(shellMessages).toHaveLength(1);
    expect(shellMessages[0]?.content).toBe('deferred command output');
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
});

class DeferredFirstCallModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'call_shell_deferred',
          name: 'run_shell_command',
          arguments: JSON.stringify({ command: 'printf direct-deferred' }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Deferred command completed.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class DuplicateToolSearchModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'assistant_metadata',
        providerMetadata: {
          schemaVersion: 3,
          source: {
            providerId: 'provider-1',
            providerKind: 'openai-responses',
            model: 'gpt-test',
            endpointFingerprint: 'a'.repeat(64),
          },
          assistantReplay: {
            responseId: 'resp_1',
            blocks: [
              { type: 'tool_call', id: 'search_1', name: 'tool_search', arguments: { query: 'shell command' } },
              { type: 'tool_call', id: 'search_2', name: 'tool_search', arguments: { query: 'terminal execution' } },
            ],
          },
        },
      };
      yield {
        type: 'item_started',
        item: {
          id: 'pi_search_1',
          kind: 'tool_call',
          status: 'in_progress',
        },
      };
      yield {
        type: 'tool_call_delta',
        call: { id: 'search_1', name: 'tool_search', argumentsDelta: '{"query":"shell command"}' },
      };
      yield {
        type: 'item_completed',
        item: {
          id: 'pi_search_1',
          kind: 'tool_call',
          status: 'completed',
          toolCall: { id: 'search_1', name: 'tool_search', arguments: '{"query":"shell command"}' },
        },
      };
      yield {
        type: 'item_started',
        item: {
          id: 'pi_search_2',
          kind: 'tool_call',
          status: 'in_progress',
        },
      };
      yield {
        type: 'tool_call_delta',
        call: { id: 'search_2', name: 'tool_search', argumentsDelta: '{"query":"terminal execution"}' },
      };
      yield {
        type: 'item_completed',
        item: {
          id: 'pi_search_2',
          kind: 'tool_call',
          status: 'completed',
          toolCall: { id: 'search_2', name: 'tool_search', arguments: '{"query":"terminal execution"}' },
        },
      };
      yield {
        type: 'tool_calls',
        toolCalls: [
          { id: 'search_1', name: 'tool_search', arguments: '{"query":"shell command"}' },
          { id: 'search_2', name: 'tool_search', arguments: '{"query":"terminal execution"}' },
        ],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Deferred tool found.' };
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

class DeferredShellToolHost implements ToolHost {
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

  toolRuntimeProfile() {
    return { exposure: 'deferred' as const };
  }

  async runTool(_name: string, input: unknown, _context: ToolExecutionContext) {
    this.calls.push(input as { command: string });
    return { content: 'deferred command output' };
  }
}

function pageContent(message: { content: string }): string {
  const separator = message.content.indexOf('\n\n');
  return separator >= 0 ? message.content.slice(separator + 2) : '';
}
