import type {
  ModelRequest,
  ModelStreamEvent
} from '@setsuna-desktop/contracts';
import type { ModelClient, ModelCompactionRequest } from '../../../src/ports/model-client.js';
import { type ToolExecutionContext } from '../../../src/ports/tool-host.js';

import {
  CapturingToolHost,
  isSlowTestPlatform
} from './shared.js';

export const longAgentLoopTestTimeoutMs = isSlowTestPlatform ? 60_000 : 20_000;

export class LongToolChainModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly toolCallBatches: number) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length > this.toolCallBatches) {
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

export class ContextCompactionModelClient implements ModelClient {
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

export class BlockingContextCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private markStarted: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    this.markStarted();
    await new Promise<void>((resolve) => {
      if (!request.signal) {
        resolve();
        return;
      }
      if (request.signal.aborted) {
        resolve();
        return;
      }
      request.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    request.signal?.throwIfAborted();
    yield { type: 'text_delta', text: 'should not finish' };
  }
}

export class AutoCompactionModelClient implements ModelClient {
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

export class RemoteCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  compactRequests: ModelCompactionRequest[] = [];

  async compactConversation(request: ModelCompactionRequest) {
    this.compactRequests.push(request);
    return {
      summary: JSON.stringify({
        summary: 'Remote provider compacted the older history.',
        important_constraints: ['Preserve the latest user request.'],
        open_items: ['Continue after remote compaction.'],
        already_said: 'Older context was compacted by the provider-native path.',
        tool_context: 'No active tool context.',
      }),
      usage: {
        provider: 'openai-responses',
        model: 'gpt-compact',
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      },
    };
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    yield { type: 'text_delta', text: 'Final answer after remote compaction.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class LongToolChainCompactionModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly toolCallBatches: number) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'context-compaction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          summary: 'Summarized oversized tool output.',
          important_constraints: ['Keep the user request and tool-call intent.'],
          open_items: ['Continue after the tool result.'],
          already_said: 'The raw tool output was too large for the active context window.',
          tool_context: 'The read_file result was summarized instead of replayed verbatim.',
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    const mainRequestCount = this.requests.filter((item) => item.model === 'local-runtime-smoke').length;
    if (mainRequestCount <= this.toolCallBatches) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: `call_tool_${mainRequestCount}`,
          name: 'workspace_read_file',
          arguments: JSON.stringify({ path: `report-part-${mainRequestCount}.txt` }),
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Final answer after summarized tool result.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class LateLargeToolResultHost extends CapturingToolHost {
  readonly largeContent = 'BEGIN_HUGE_TOOL_OUTPUT ' + 'huge generated report '.repeat(90_000);

  constructor(private readonly largeResultCall: number) {
    super();
  }

  override async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    this.calls.push({ name, input, projectId: context.projectId });
    return {
      content: this.calls.length === this.largeResultCall
        ? this.largeContent
        : `small report part ${this.calls.length}`,
    };
  }
}