import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeToolDefinition
} from '@setsuna-desktop/contracts';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { type ToolExecutionContext, type ToolHost } from '../../../src/ports/tool-host.js';


export class ExternalContextToolHost implements ToolHost {
  constructor(
    private readonly toolName = 'mcp__search__fetch',
    private readonly containsExternalContext = false,
  ) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: this.toolName,
        description: 'Fetch external search context',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ];
  }

  async runTool() {
    return { content: 'external search result', containsExternalContext: this.containsExternalContext };
  }
}

export class ExternalContextMemoryModelClient implements ModelClient {
  requests: ModelRequest[] = [];

  constructor(private readonly toolName = 'mcp__search__fetch') {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (request.model === 'passive-memory-extraction') {
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          memories: [{ content: '这条外部搜索结果不应该被长期记忆。', scope: 'global' }],
        }),
      };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 1) {
      yield {
        type: 'tool_calls',
        toolCalls: [{ id: 'call_external', name: this.toolName, arguments: '{"query":"setsuna"}' }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Used external context.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

export class ActiveMemoryModelClient implements ModelClient {
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