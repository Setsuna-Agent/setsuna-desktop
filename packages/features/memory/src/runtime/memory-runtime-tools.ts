import { runtimeText } from '@setsuna-desktop/contracts';
import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type {
  MemoryToolContext,
  MemoryToolExecutionResult,
} from '../contracts/capabilities.js';
import type { MemoryPreferences } from '../contracts/settings.js';
import type { MemoryStore } from '../contracts/store.js';
import {
  numberArg,
  objectInput,
  optionalStringArg,
  requiredStringArg,
} from './runtime-helpers.js';

const SHARED_MEMORY_FILES_FEATURE = 'memory_unscoped_files';

export class MemoryRuntimeTools {
  constructor(
    private readonly memories: MemoryStore,
    private readonly readPreferences: () => Promise<MemoryPreferences>,
  ) {}

  async systemPrompt(context: MemoryToolContext): Promise<string | null> {
    const text = runtimeText(context.interfaceLanguage);
    const visibility = await this.toolVisibility();
    const lines: string[] = [];
    if (visibility.canRead) {
      lines.push(
        text('Memory tools read the local Setsuna memory store.', "记忆工具读取本地 Setsuna 记忆存储。"),
        canUseSharedMemoryFiles(context)
          ? text('Use recall_memory first; list_memory_files, read_memory_file, and search_memory_files are available for source-grounded memory details.', "优先使用 recall_memory；需要依据原始来源查看记忆详情时，可用 list_memory_files、read_memory_file 和 search_memory_files。")
          : context?.projectId
            ? text('Use recall_memory for source-grounded details. Results are restricted to global memories and the current project.', "使用 recall_memory 获取有来源依据的详情；结果仅包含全局记忆和当前项目记忆。")
            : text('Use recall_memory for source-grounded details. Results are restricted to global memories.', "使用 recall_memory 获取有来源依据的详情；结果仅包含全局记忆。"),
        text('When the final answer relies on memory content, append a hidden <oai-mem-citation> block at the very end with exact source ranges and rollout_ids when available.', "最终答复依赖记忆内容时，在最末尾附上隐藏的 <oai-mem-citation> 块，包含准确的来源范围，以及可用的 rollout_ids。"),
      );
    }
    if (visibility.canWrite) {
      lines.push(text('Use remember_memory only when the user explicitly asks to save durable preferences, project rules, workflows, decisions, or facts.', "只有用户明确要求保存长期偏好、项目规则、工作流、决策或事实时，才使用 remember_memory。"));
    }
    return lines.join('\n') || null;
  }

  async listTools(context: MemoryToolContext): Promise<RuntimeToolDefinition[]> {
    const text = runtimeText(context.interfaceLanguage);
    const visibility = await this.toolVisibility();
    const tools: RuntimeToolDefinition[] = [];
    if (visibility.canWrite) {
      tools.push({
        name: 'remember_memory',
        description: text('Save a durable local memory for future Setsuna Desktop runs.', "保存长期本地记忆，供后续 Setsuna Desktop 任务使用。"),
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', description: text('Concise memory content to save.', "要保存的简洁记忆内容。") },
            scope: { type: 'string', enum: ['global', 'project'], description: text('Memory scope. Defaults to the current project in project threads, otherwise global.', "记忆范围。项目任务默认当前项目，其他情况默认 global。") },
            kind: { type: 'string', enum: ['preference', 'project_rule', 'fact', 'workflow', 'decision', 'note'], description: text('Durable memory category. Defaults to note.', "长期记忆分类。默认 note。") },
            title: { type: 'string', description: text('Optional short title for the memory.', "可选简短记忆标题。") },
            tags: { type: 'array', items: { type: 'string' }, description: text('Optional searchable tags.', "可选可搜索标签。") },
            source: { type: 'string', description: text('Optional source label for the memory.', "可选记忆来源标签。") },
            workspaceRoot: { type: 'string', description: text('Optional workspace root for project-scoped memory dedupe.', "可选工作区根目录，用于项目范围内的记忆去重。") },
          },
          required: ['content'],
        },
      });
    }
    if (visibility.canRead) {
      tools.push({
        name: 'recall_memory',
        description: text('Recall durable local memories within the current thread scope.', "检索当前任务范围内的长期本地记忆。"),
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: text('Optional text to search in saved memories.', "可选要在已保存记忆中搜索的文本。") },
            scope: { type: 'string', enum: ['global', 'project'], description: text('Optional memory scope filter.', "可选记忆范围过滤条件。") },
            limit: { type: 'number', description: text('Maximum number of memories to return.', "最多返回的记忆条数。") },
          },
        },
      });
      // 原始记忆文件会合并所有项目，因此只能通过显式调试标志启用，防止普通全局线程和
      // 项目线程绕过结构化作用域过滤。
      if (canUseSharedMemoryFiles(context)) tools.push(
        {
          name: 'list_memory_files',
          description: text('List files in the local memory store. Use this before reading memory files when source locations are needed.', "列出本地记忆存储中的文件。需要来源位置时，先用此工具再读取记忆文件。"),
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: text('Optional memory-store path. Defaults to the memory root.', "可选记忆存储路径。默认记忆根目录。") },
              cursor: { type: 'string', description: text('Optional pagination cursor.', "可选分页游标。") },
              max_results: { type: 'number', description: text('Maximum number of entries to return.', "最多返回的条目数。") },
            },
          },
        },
        {
          name: 'read_memory_file',
          description: text('Read a local memory file by relative path, optionally starting at a 1-indexed line offset and limiting returned lines.', "按相对路径读取本地记忆文件，可指定从 1 开始的起始行和返回行数上限。"),
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: text('Memory file path, such as MEMORY.md.', "记忆文件路径，例如 MEMORY.md。") },
              line_offset: { type: 'number', description: text('Optional 1-indexed line offset.', "可选起始行号，从 1 开始。") },
              max_lines: { type: 'number', description: text('Optional maximum number of lines to return.', "可选最大返回行数。") },
            },
            required: ['path'],
          },
        },
        {
          name: 'search_memory_files',
          description: text('Search local memory files for substring matches.', "在本地记忆文件中搜索子串。"),
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              queries: { type: 'array', items: { type: 'string' }, description: text('One or more substrings to search for.', "一个或多个要搜索的子串。") },
              query: { type: 'string', description: text('Single-query shorthand.', "单个查询的简写。") },
              path: { type: 'string', description: text('Optional memory file path. Defaults to all memory files.', "可选记忆文件路径。默认搜索所有记忆文件。") },
              context_lines: { type: 'number', description: text('Context lines around matches.', "匹配前后的上下文行数。") },
              case_sensitive: { type: 'boolean', description: text('Whether matching is case sensitive. Defaults to true.', "是否区分大小写。默认 true。") },
              max_results: { type: 'number', description: text('Maximum number of matches to return.', "最多返回的匹配数。") },
            },
          },
        },
      );
    }
    return tools;
  }

  private async toolVisibility(): Promise<{ canRead: boolean; canWrite: boolean }> {
    const config = await this.readPreferences().catch(() => null);
    if (!config) return { canRead: false, canWrite: false };
    return {
      canRead: config.useMemories,
      canWrite: config.generateMemories,
    };
  }

  async runTool(name: string, input: unknown, context: MemoryToolContext): Promise<MemoryToolExecutionResult> {
    const args = objectInput(input);

    if (name === 'remember_memory') {
      const memory = await this.memories.rememberMemory({
        content: requiredStringArg(args.content, 'content'),
        scope: memoryScope(args.scope),
        kind: memoryKind(args.kind),
        projectId: context.projectId,
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
        scope: context.projectId ? memoryScope(args.scope) : 'global',
        projectId: context.projectId,
        limit: numberArg(args.limit),
      });
      return {
        content: result.memories.map((memory) => `- [${memory.scope}]${memory.sourceLocation ? ` source=${memorySourceLocationText(memory.sourceLocation)}` : ''} ${memory.content}`).join('\n') || 'No matching local memories.',
        data: result,
      };
    }

    if (!canUseSharedMemoryFiles(context) && (name === 'list_memory_files' || name === 'read_memory_file' || name === 'search_memory_files')) {
      throw new Error('Shared memory files are unavailable in scoped threads. Use recall_memory instead.');
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

function jsonResult(data: unknown): MemoryToolExecutionResult {
  return {
    content: JSON.stringify(data, null, 2),
    data,
  };
}

function canUseSharedMemoryFiles(context: MemoryToolContext | undefined): boolean {
  return !context?.projectId && context?.features?.[SHARED_MEMORY_FILES_FEATURE] === true;
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
