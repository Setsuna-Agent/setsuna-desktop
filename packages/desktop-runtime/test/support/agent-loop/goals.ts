import type {
  ModelRequest,
  ModelStreamEvent
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';


export class PersistentGoalModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'goal_read_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield { type: 'text_delta', text: 'First goal chunk complete.' };
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 3) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'goal_update_1', name: 'update_goal', arguments: '{"status":"complete"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Goal verified complete.' };
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class GoalSteerModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirst: () => void = () => undefined;
  private readonly firstReleased = new Promise<void>((resolve) => {
    this.releaseFirst = resolve;
  });

  releaseFirstResponse(): void {
    this.releaseFirst();
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'text_delta', text: 'Initial goal work.' };
      await this.firstReleased;
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'goal_steer_complete', name: 'update_goal', arguments: '{"status":"complete"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Goal completed with the guidance.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}