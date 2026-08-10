import type {
  ModelRequest,
  ModelStreamEvent
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { CancellableModelClient } from './shared.js';


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

export class NoProgressGoalModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'No new evidence yet.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ReplacingGoalModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'goal_replace',
          name: 'create_goal',
          arguments: '{"objective":"Replacement objective"}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'goal_replace_complete', name: 'update_goal', arguments: '{"status":"complete"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Replacement goal completed.' };
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class RegularTurnCreatesPersistentGoalModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'goal_create_regular',
          name: 'create_goal',
          arguments: '{"objective":"Persistent objective from regular turn"}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield { type: 'text_delta', text: 'The persistent goal is ready to continue.' };
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 3) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'goal_complete_continuation', name: 'update_goal', arguments: '{"status":"complete"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'The persistent goal is complete.' };
    yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } };
    yield { type: 'done', finishReason: 'stop' };
  }
}

/** Holds the founding regular turn open after create_goal so pause semantics can be exercised. */
export class RegularTurnCreatesCancellableGoalModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private readonly cancellable = new CancellableModelClient({
    inputTokens: 3,
    outputTokens: 2,
    totalTokens: 5,
  });

  get aborted(): boolean {
    return this.cancellable.aborted;
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'goal_create_then_pause',
          name: 'create_goal',
          arguments: '{"objective":"Pause the founding regular turn"}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }

    yield* this.cancellable.stream(request);
  }

  async waitUntilAbortListenerReady(): Promise<void> {
    await this.cancellable.waitUntilAbortListenerReady();
  }
}

export class EditedGoalModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirst: () => void = () => undefined;
  private readonly firstReleased = new Promise<void>((resolve) => {
    this.releaseFirst = resolve;
  });

  releaseStaleCompletion(): void {
    this.releaseFirst();
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      await this.firstReleased;
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'goal_stale_complete', name: 'update_goal', arguments: '{"status":"complete"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    if (this.requests.length === 2) {
      yield { type: 'text_delta', text: 'The goal changed, so I will continue with the edited objective.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 3) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'goal_edited_complete', name: 'update_goal', arguments: '{"status":"complete"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Edited goal verified complete.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}
