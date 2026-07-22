import type {
  ModelRequest,
  ModelStreamEvent
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';


export class ItemBasedModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'plan_delta', itemId: 'plan_item_1', text: '1. Inspect state.' };
    yield {
      type: 'item_started',
      item: { id: 'reasoning_item_1', kind: 'reasoning', status: 'in_progress' },
    };
    yield { type: 'reasoning_summary_part_added', itemId: 'reasoning_item_1', summaryIndex: 0 };
    yield { type: 'reasoning_summary_delta', itemId: 'reasoning_item_1', text: 'Need context.', summaryIndex: 0 };
    yield {
      type: 'item_completed',
      item: { id: 'reasoning_item_1', kind: 'reasoning', content: 'Need context.', status: 'completed' },
    };
    yield {
      type: 'item_started',
      item: { id: 'agent_item_1', kind: 'agent_message', status: 'in_progress' },
    };
    yield { type: 'item_delta', itemId: 'agent_item_1', delta: 'Hello ' };
    yield { type: 'item_delta', itemId: 'agent_item_1', delta: 'from item stream.' };
    yield {
      type: 'item_completed',
      item: { id: 'agent_item_1', kind: 'agent_message', content: 'Hello from item stream.', status: 'completed' },
    };
    yield {
      type: 'token_count',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      modelContextWindow: 128000,
    };
    yield { type: 'turn_diff', unifiedDiff: 'diff --git a/README.md b/README.md\n+Hello\n' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class NativeItemToolCallModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      const toolCall = { id: 'call_native_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' };
      yield {
        type: 'item_started',
        item: { id: toolCall.id, kind: 'tool_call', status: 'in_progress', toolCall },
      };
      yield {
        type: 'item_completed',
        item: { id: toolCall.id, kind: 'tool_call', status: 'completed', toolCall },
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield {
      type: 'item_started',
      item: { id: 'agent_native_1', kind: 'agent_message', status: 'in_progress' },
    };
    yield { type: 'item_delta', itemId: 'agent_native_1', delta: 'Native item tool result handled.' };
    yield {
      type: 'item_completed',
      item: { id: 'agent_native_1', kind: 'agent_message', content: 'Native item tool result handled.', status: 'completed' },
    };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class RegenerateModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: `answer ${this.requests.length}` };
    yield { type: 'done', finishReason: 'stop' };
  }
}