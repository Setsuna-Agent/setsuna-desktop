import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { MemoryStore } from '../../ports/memory-store.js';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import { numberArg, objectInput, optionalStringArg, requiredStringArg } from './tool-input.js';

export class MemoryToolHost implements ToolHost {
  constructor(private readonly memories: MemoryStore) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [
      {
        name: 'remember_memory',
        description: 'Save a durable local memory for future Setsuna Desktop runs.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', description: 'Concise memory content to save.' },
            scope: { type: 'string', enum: ['global', 'project'], description: 'Memory scope. Defaults to global unless projectId is provided.' },
            projectId: { type: 'string', description: 'Optional local project id for project-scoped memory.' },
          },
          required: ['content'],
        },
      },
      {
        name: 'recall_memory',
        description: 'Recall durable local memories, optionally filtered by query or project.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'Optional text to search in saved memories.' },
            scope: { type: 'string', enum: ['global', 'project'], description: 'Optional memory scope filter.' },
            projectId: { type: 'string', description: 'Optional local project id; global memories are included with project matches.' },
            limit: { type: 'number', description: 'Maximum number of memories to return.' },
          },
        },
      },
    ];
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const args = objectInput(input);

    if (name === 'remember_memory') {
      const memory = await this.memories.rememberMemory({
        content: requiredStringArg(args.content, 'content'),
        scope: memoryScope(args.scope),
        projectId: optionalStringArg(args.projectId) ?? context.projectId,
        sourceThreadId: context.threadId,
        sourceTurnId: context.turnId,
      });
      return {
        content: `Saved memory ${memory.id} (${memory.scope}).`,
        data: memory,
      };
    }

    if (name === 'recall_memory') {
      const result = await this.memories.listMemories({
        search: optionalStringArg(args.query),
        scope: memoryScope(args.scope),
        projectId: optionalStringArg(args.projectId) ?? context.projectId,
        limit: numberArg(args.limit),
      });
      return {
        content: result.memories.map((memory) => `- [${memory.scope}] ${memory.content}`).join('\n') || 'No matching local memories.',
        data: result,
      };
    }

    throw new Error(`Unknown memory tool: ${name}`);
  }
}

function memoryScope(value: unknown): 'global' | 'project' | undefined {
  if (value === 'global' || value === 'project') return value;
  return undefined;
}
