import type {
  ModelRequest,
  ModelStreamEvent
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';


export class MemoryCitationModelClient implements ModelClient {
  async *stream(_request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    yield { type: 'text_delta', text: 'Answer <oai-mem-' };
    yield {
      type: 'text_delta',
      text: [
        'citation>',
        '<citation_entries>',
        'MEMORY.md:1-2|note=[summary]',
        '</citation_entries>',
        '<rollout_ids>',
        'thread_a',
        'thread_b',
        'thread_a',
        '</rollout_ids>',
        '</oai-mem-',
      ].join('\n'),
    };
    yield { type: 'text_delta', text: 'citation> done.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class RememberMemoryToolModelClient implements ModelClient {
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