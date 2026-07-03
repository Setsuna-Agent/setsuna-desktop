import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ConfigStore } from '../../ports/config-store.js';
import type { MemoryStore } from '../../ports/memory-store.js';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import { numberArg, objectInput, optionalStringArg, requiredStringArg } from './tool-input.js';

export class MemoryToolHost implements ToolHost {
  constructor(
    private readonly memories: MemoryStore,
    private readonly configStore?: ConfigStore,
  ) {}

  async systemPrompt(): Promise<string | null> {
    const visibility = await this.toolVisibility();
    const lines: string[] = [];
    if (visibility.canRead && visibility.dedicatedTools) {
      lines.push(
        'Memory tools read the local Setsuna memory store.',
        'Use list_memory_files, read_memory_file, and search_memory_files when an answer needs source-grounded memory details.',
        'When the final answer relies on memory file content, append a hidden <oai-mem-citation> block at the very end with exact memory file line ranges and rollout_ids when available.',
      );
    }
    if (visibility.canWrite && visibility.dedicatedTools) {
      lines.push('Use remember_memory only when the user explicitly asks to save durable preferences, project rules, workflows, decisions, or facts.');
    }
    return lines.join('\n') || null;
  }

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    const visibility = await this.toolVisibility();
    const tools: RuntimeToolDefinition[] = [];
    if (!visibility.dedicatedTools) return tools;
    if (visibility.canWrite) {
      tools.push({
        name: 'remember_memory',
        description: 'Save a durable local memory for future Setsuna Desktop runs.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', description: 'Concise memory content to save.' },
            scope: { type: 'string', enum: ['global', 'project'], description: 'Memory scope. Defaults to global unless projectId is provided.' },
            kind: { type: 'string', enum: ['preference', 'project_rule', 'fact', 'workflow', 'decision', 'note'], description: 'Durable memory category. Defaults to note.' },
            title: { type: 'string', description: 'Optional short title for the memory.' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional searchable tags.' },
            source: { type: 'string', description: 'Optional source label for the memory.' },
            projectId: { type: 'string', description: 'Optional local project id for project-scoped memory.' },
            workspaceRoot: { type: 'string', description: 'Optional workspace root for project-scoped memory dedupe.' },
          },
          required: ['content'],
        },
      });
    }
    if (visibility.canRead) {
      tools.push(
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
        {
          name: 'list_memory_files',
          description: 'List files in the local memory store. Use this before reading memory files when source locations are needed.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: 'Optional memory-store path. Defaults to the memory root.' },
              cursor: { type: 'string', description: 'Optional pagination cursor.' },
              max_results: { type: 'number', description: 'Maximum number of entries to return.' },
            },
          },
        },
        {
          name: 'read_memory_file',
          description: 'Read a local memory file by relative path, optionally starting at a 1-indexed line offset and limiting returned lines.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: 'Memory file path, such as MEMORY.md.' },
              line_offset: { type: 'number', description: 'Optional 1-indexed line offset.' },
              max_lines: { type: 'number', description: 'Optional maximum number of lines to return.' },
            },
            required: ['path'],
          },
        },
        {
          name: 'search_memory_files',
          description: 'Search local memory files for substring matches.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              queries: { type: 'array', items: { type: 'string' }, description: 'One or more substrings to search for.' },
              query: { type: 'string', description: 'Single-query shorthand.' },
              path: { type: 'string', description: 'Optional memory file path. Defaults to all memory files.' },
              context_lines: { type: 'number', description: 'Context lines around matches.' },
              case_sensitive: { type: 'boolean', description: 'Whether matching is case sensitive. Defaults to true.' },
              max_results: { type: 'number', description: 'Maximum number of matches to return.' },
            },
          },
        },
      );
    }
    return tools;
  }

  private async toolVisibility(): Promise<{ canRead: boolean; canWrite: boolean; dedicatedTools: boolean }> {
    if (!this.configStore) return { canRead: true, canWrite: true, dedicatedTools: true };
    const config = await this.configStore.getConfig().catch(() => null);
    if (!config) return { canRead: false, canWrite: false, dedicatedTools: false };
    return {
      canRead: config.memory?.useMemories ?? config.memoryEnabled,
      canWrite: config.memory?.generateMemories ?? config.memoryEnabled,
      dedicatedTools: config.memory?.dedicatedTools ?? false,
    };
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const args = objectInput(input);

    if (name === 'remember_memory') {
      const memory = await this.memories.rememberMemory({
        content: requiredStringArg(args.content, 'content'),
        scope: memoryScope(args.scope),
        kind: memoryKind(args.kind),
        projectId: optionalStringArg(args.projectId) ?? context.projectId,
        title: optionalStringArg(args.title),
        tags: stringArrayArg(args.tags),
        source: optionalStringArg(args.source),
        workspaceRoot: optionalStringArg(args.workspaceRoot),
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
        content: result.memories.map((memory) => `- [${memory.scope}]${memory.sourceLocation ? ` source=${memorySourceLocationText(memory.sourceLocation)}` : ''} ${memory.content}`).join('\n') || 'No matching local memories.',
        data: result,
      };
    }

    if (name === 'list_memory_files') {
      const result = await this.memories.listMemoryFiles({
        path: optionalStringArg(args.path),
        cursor: optionalStringArg(args.cursor),
        maxResults: numberArg(args.max_results ?? args.maxResults),
      });
      return jsonResult(result);
    }

    if (name === 'read_memory_file') {
      const result = await this.memories.readMemoryFile({
        path: requiredStringArg(args.path, 'path'),
        lineOffset: numberArg(args.line_offset ?? args.lineOffset),
        maxLines: numberArg(args.max_lines ?? args.maxLines),
      });
      return jsonResult({
        path: result.path,
        content: result.content,
        start_line_number: result.startLineNumber,
        truncated: result.truncated,
      });
    }

    if (name === 'search_memory_files') {
      const result = await this.memories.searchMemoryFiles({
        queries: memorySearchQueries(args.queries, args.query),
        path: optionalStringArg(args.path),
        contextLines: numberArg(args.context_lines ?? args.contextLines),
        caseSensitive: booleanArg(args.case_sensitive ?? args.caseSensitive),
        maxResults: numberArg(args.max_results ?? args.maxResults),
      });
      return jsonResult({
        queries: result.queries,
        match_mode: result.matchMode,
        path: result.path ?? null,
        matches: result.matches.map((match) => ({
          path: match.path,
          match_line_number: match.matchLineNumber,
          content_start_line_number: match.contentStartLineNumber,
          content: match.content,
          matched_queries: match.matchedQueries,
        })),
        next_cursor: result.nextCursor ?? null,
        truncated: result.truncated,
      });
    }

    throw new Error(`Unknown memory tool: ${name}`);
  }
}

function jsonResult(data: unknown): ToolExecutionResult {
  return {
    content: JSON.stringify(data, null, 2),
    data,
  };
}

function memorySourceLocationText(location: { path: string; lineStart: number; lineEnd: number }): string {
  return `${location.path}:${location.lineStart}-${location.lineEnd}`;
}

function memoryScope(value: unknown): 'global' | 'project' | undefined {
  if (value === 'global' || value === 'project') return value;
  return undefined;
}

function memoryKind(value: unknown) {
  if (value === 'preference' || value === 'project_rule' || value === 'fact' || value === 'workflow' || value === 'decision' || value === 'note') return value;
  return undefined;
}

function booleanArg(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function memorySearchQueries(value: unknown, shorthand: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  const query = optionalStringArg(shorthand);
  return query ? [query] : [];
}

function stringArrayArg(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}
