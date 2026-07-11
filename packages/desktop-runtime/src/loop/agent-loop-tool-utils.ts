import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeConfigState,
  RuntimeDynamicToolCallResult,
  RuntimeDynamicToolContentItem,
  RuntimeDynamicToolDefinition,
  RuntimeModelRequestStepSnapshot,
  RuntimeToolCall,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import { COLLABORATION_TOOL_DEFINITIONS, collaborationToolsEnabled, isCollaborationToolName } from './collaboration-coordinator.js';
import { GOAL_TOOL_DEFINITIONS, goalToolsEnabled, isGoalToolName } from './runtime-goal-coordinator.js';
import { FILE_MUTATION_TOOL_NAMES } from './tool-orchestrator.js';
import { parseJsonObjectFromText } from './prompt-utils.js';
import type { RuntimeToolRouter } from './tool-router.js';

export type ToolBudget = {
  readFileCallCount: number;
  inspectionCallCount: number;
  fileMutationCallCount: number;
};

export type ToolBudgetBlock = {
  content: string;
  display: string;
};

type ToolBudgetLimit = number | null;

const MAX_TOOL_ROUNDS = 200;
// null 表示“统计但不限制”；计数器仍保留，后续打开限额或测试 defer 文案时不用重写流程。
const MAX_READ_FILE_CALLS_PER_RUN: ToolBudgetLimit = null;
const MAX_INSPECTION_CALLS_PER_RUN: ToolBudgetLimit = null;
const MAX_FILE_MUTATION_CALLS_PER_RUN: ToolBudgetLimit = null;
const READ_FILE_TOOL_NAMES = new Set(['read_file', 'workspace_read_file']);
const INSPECTION_TOOL_NAMES = new Set(['list_directory', 'find_files', 'search_text', 'read_file', 'git_status', 'read_diff', 'workspace_list_directory', 'workspace_search_text', 'workspace_read_file']);

export function parseToolArguments(value: string): unknown {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function appServerRpcId(id: string | number | null | undefined): string {
  if (typeof id === 'string') return id.trim();
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return '';
}

export function appServerDynamicToolErrorMessage(error: unknown): string {
  const input = isPlainRecord(error) ? error : {};
  const message = typeof input.message === 'string' && input.message.trim() ? input.message.trim() : 'Dynamic tool call failed.';
  const code = typeof input.code === 'number' && Number.isFinite(input.code) ? ` (${input.code})` : '';
  return `${message}${code}`;
}

export function appServerDynamicToolResult(value: unknown): RuntimeDynamicToolCallResult {
  const input = isPlainRecord(value) ? value : {};
  const contentItemsInput = Array.isArray(input.contentItems)
    ? input.contentItems
    : typeof input.content === 'string'
      ? [{ type: 'inputText', text: input.content }]
      : [];
  if (!contentItemsInput.length) throw new Error('Dynamic tool response must include contentItems.');
  const contentItems = contentItemsInput.map((item, index) => appServerDynamicToolContentItem(item, index));
  return {
    contentItems,
    ...(typeof input.success === 'boolean' ? { success: input.success } : {}),
  };
}

function appServerDynamicToolContentItem(value: unknown, index: number): RuntimeDynamicToolContentItem {
  const input = isPlainRecord(value) ? value : {};
  if (input.type === 'inputText' && typeof input.text === 'string') {
    return { type: 'inputText', text: input.text };
  }
  if (input.type === 'inputImage' && typeof input.imageUrl === 'string' && input.imageUrl.startsWith('data:image/')) {
    return { type: 'inputImage', imageUrl: input.imageUrl };
  }
  throw new Error(`Invalid dynamic tool contentItems[${index}].`);
}

export function appServerDynamicToolContent(contentItems: RuntimeDynamicToolContentItem[], success: boolean): string {
  const text = contentItems
    .map((item) => item.type === 'inputText' ? item.text : `[inputImage:${item.imageUrl.slice(0, 80)}]`)
    .join('\n')
    .trim();
  const content = text || JSON.stringify({ contentItems });
  return success ? content : `Dynamic tool reported failure:\n${content}`;
}

export function modelFacingTools(
  tools: RuntimeToolDefinition[] | undefined,
  config: RuntimeConfigState | null | undefined,
  dynamicTools: RuntimeDynamicToolDefinition[] | undefined,
  revealedDeferredToolNames: ReadonlySet<string>,
  threadHasGoal = false,
): RuntimeToolDefinition[] | undefined {
  const names = new Set((tools ?? []).map((tool) => tool.name));
  const merged = [...(tools ?? [])];
  if (collaborationToolsEnabled(config)) {
    for (const tool of COLLABORATION_TOOL_DEFINITIONS) {
      if (!names.has(tool.name)) {
        names.add(tool.name);
        merged.push(tool);
      }
    }
  }
  if (goalToolsEnabled(config, threadHasGoal)) {
    for (const tool of GOAL_TOOL_DEFINITIONS) {
      if (!names.has(tool.name)) {
        names.add(tool.name);
        merged.push(tool);
      }
    }
  }
  for (const tool of dynamicTools ?? []) {
    if ((tool.deferLoading && !revealedDeferredToolNames.has(tool.name)) || names.has(tool.name)) continue;
    names.add(tool.name);
    merged.push(tool);
  }
  return merged.length ? merged : undefined;
}

export function toolsForModelRequest(tools: RuntimeToolDefinition[] | undefined, toolChoice: ModelRequest['toolChoice']): RuntimeToolDefinition[] | undefined {
  if (!tools?.length || !toolChoice || toolChoice === 'auto' || toolChoice === 'none') return tools;
  const forcedTool = tools.find((tool) => tool.name === toolChoice.name);
  return forcedTool ? [forcedTool] : tools;
}

export async function samplingToolRuntimes(
  tools: RuntimeToolDefinition[],
  toolRouter: RuntimeToolRouter | null,
  dynamicTools: RuntimeDynamicToolDefinition[] | undefined,
  config: RuntimeConfigState | null | undefined,
  threadHasGoal = false,
): Promise<RuntimeModelRequestStepSnapshot['toolRuntimes']> {
  if (!tools.length) return [];
  const routerRuntimes = new Map((await toolRouter?.toolRuntimeMetadata() ?? []).map((runtime) => [runtime.name, runtime]));
  const dynamicToolNames = new Set((dynamicTools ?? []).map((tool) => tool.name));
  const collaborationEnabled = collaborationToolsEnabled(config);
  const goalsEnabled = goalToolsEnabled(config, threadHasGoal);
  return tools.map((tool) => {
    const routerRuntime = routerRuntimes.get(tool.name);
    if (routerRuntime) return { ...routerRuntime };
    return {
      name: tool.name,
      source: collaborationEnabled && isCollaborationToolName(tool.name)
        ? 'collaboration'
        : goalsEnabled && isGoalToolName(tool.name) ? 'goal'
        : dynamicToolNames.has(tool.name) ? 'dynamic' : 'host',
      exposure: 'direct',
      supportsParallel: false,
      waitsForRuntimeCancellation: true,
    };
  });
}

/**
 * 合并流式工具参数片段，兼容全量覆盖和增量追加两种模型输出方式。
 *
 * @param current 当前已合并的参数字符串。
 * @param delta 本次收到的参数片段。
 */
export function mergeToolArgumentDelta(current: string, delta: string): string {
  if (!delta) return current;
  if (!current) return delta;
  if (delta.startsWith(current)) return delta;
  if (current.endsWith(delta)) return current;
  return `${current}${delta}`;
}

/**
 * 判断是否需要在连续查看类工具前先给用户一个进度提示。
 *
 * @param roundText 本轮 assistant 已输出的文本。
 * @param toolCalls 本轮模型请求的工具调用列表。
 */
export function shouldPublishInspectionProgressNote(roundText: string, toolCalls: RuntimeToolCall[]): boolean {
  if (stripThinkingMarkup(roundText).trim()) return false;
  return toolCalls.filter(isInspectionToolCall).length > 1;
}

export function isInspectionToolCall(toolCall: RuntimeToolCall): boolean {
  return INSPECTION_TOOL_NAMES.has(toolCall.name);
}

export function deferredToolCallDisplay(executedInspectionCount: number): string {
  return `本轮已先执行 ${executedInspectionCount} 个本地查看，后续操作已暂缓。`;
}

/**
 * 生成回填给模型的工具暂缓内容，明确告知该工具没有执行。
 *
 * @param toolCall 被暂缓的工具调用。
 * @param executedInspectionCount 当前模型轮次已执行的查看类工具数量。
 */
export function deferredToolCallContent(toolCall: RuntimeToolCall, executedInspectionCount: number): string {
  return [`Deferred by desktop runtime: ${toolCall.name} was not executed.`, `The current model response already executed ${executedInspectionCount} local inspection calls.`, 'Summarize the completed inspection batch before requesting more workspace inspection.', 'Do not assume this deferred tool call happened.'].join('\n');
}

function stripThinkingMarkup(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/g, '');
}

/**
 * 判断某个工具调用是否被当前预算挡住，并生成对应模型/展示文案。
 *
 * @param toolCall 待执行的工具调用。
 * @param budget 当前 turn 已累计的工具预算。
 */
export function toolBudgetBlockForCall(toolCall: RuntimeToolCall, budget: ToolBudget): ToolBudgetBlock | null {
  const name = toolCall.name;
  const readFileLimit = MAX_READ_FILE_CALLS_PER_RUN;
  if (READ_FILE_TOOL_NAMES.has(name) && isToolBudgetExhausted(budget.readFileCallCount, readFileLimit)) {
    return {
      display: `本次请求已读取 ${readFileLimit} 个文件，剩余本地操作已暂缓。`,
      content: ['Skipped by desktop runtime: The read_file budget for this user request is exhausted.', `Already executed this turn: ${budget.readFileCallCount}/${readFileLimit}.`, `Skipped call: ${name}.`].join('\n'),
    };
  }
  const inspectionLimit = MAX_INSPECTION_CALLS_PER_RUN;
  if (INSPECTION_TOOL_NAMES.has(name) && isToolBudgetExhausted(budget.inspectionCallCount, inspectionLimit)) {
    return {
      display: `本次请求已查看 ${inspectionLimit} 个文件/目录，剩余本地操作已暂缓。`,
      content: ['Skipped by desktop runtime: The inspection budget for this user request is exhausted.', `Already executed this turn: ${budget.inspectionCallCount}/${inspectionLimit}.`, `Skipped call: ${name}.`].join('\n'),
    };
  }
  const fileMutationLimit = MAX_FILE_MUTATION_CALLS_PER_RUN;
  if (FILE_MUTATION_TOOL_NAMES.has(name) && isToolBudgetExhausted(budget.fileMutationCallCount, fileMutationLimit)) {
    return {
      display: `本次请求已执行 ${fileMutationLimit} 个文件变更，剩余本地操作已暂缓。`,
      content: ['Skipped by desktop runtime: The file mutation budget for this user request is exhausted.', `Already executed this turn: ${budget.fileMutationCallCount}/${fileMutationLimit}.`, `Skipped call: ${name}.`].join('\n'),
    };
  }
  return null;
}

function isToolBudgetExhausted(count: number, limit: ToolBudgetLimit): limit is number {
  return limit !== null && count >= limit;
}

export function normalizedMaxToolRounds(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_TOOL_ROUNDS;
  return Math.max(1, Math.floor(value));
}

export function toolCallFromModelStreamItem(event: ModelStreamEvent): RuntimeToolCall | null {
  if (event.type !== 'item_started' && event.type !== 'item_completed') return null;
  const { item } = event;
  if (item.kind !== 'tool_call') return null;
  const toolCall = item.toolCall;
  if (!toolCall?.id || !toolCall.name) return null;
  return toolCall;
}

export function upsertRuntimeToolCall(toolCalls: RuntimeToolCall[], next: RuntimeToolCall): RuntimeToolCall[] {
  const index = toolCalls.findIndex((toolCall) => toolCall.id === next.id);
  if (index < 0) return [...toolCalls, { ...next }];
  const copy = [...toolCalls];
  copy[index] = {
    ...copy[index],
    ...next,
    arguments: next.arguments || copy[index]?.arguments || '',
  };
  return copy;
}

export function markToolBudgetProcessed(budget: ToolBudget, toolCall: RuntimeToolCall): void {
  reserveToolBudgetForCall(budget, toolCall);
}

export function reserveToolBudgetForCall(budget: ToolBudget, toolCall: RuntimeToolCall): void {
  const name = toolCall.name;
  if (READ_FILE_TOOL_NAMES.has(name)) budget.readFileCallCount += 1;
  if (INSPECTION_TOOL_NAMES.has(name)) budget.inspectionCallCount += 1;
  if (FILE_MUTATION_TOOL_NAMES.has(name)) budget.fileMutationCallCount += 1;
}

/**
 * 生成只读文件工具的去重 key，避免并行批次重复读取同一片段。
 *
 * @param toolCall 待读取的工具调用。
 * @param parsedArguments 已解析的工具参数。
 */
export function parallelReadFileKey(toolCall: RuntimeToolCall, parsedArguments: unknown): string {
  if (!READ_FILE_TOOL_NAMES.has(toolCall.name) || !isPlainRecord(parsedArguments)) return '';
  return [String(parsedArguments.file_path ?? parsedArguments.path ?? '').trim(), String(parsedArguments.offset ?? ''), String(parsedArguments.limit ?? ''), String(parsedArguments.start_line ?? ''), String(parsedArguments.end_line ?? '')].join('\0');
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function previewArguments(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').slice(0, 1200);
}

export function previewPartialArguments(value: string): string {
  return value.slice(0, 1200);
}

/**
 * 截断工具输出，避免超大结果写入事件 payload。
 *
 * @param value 工具完整输出。
 */
export function previewToolContent(value: string): string {
  return value.length > 60_000 ? `${value.slice(0, 60_000)}\n[truncated ${value.length - 60_000} chars]` : value;
}

export function unifiedDiffFromToolPreview(value: string | undefined): string {
  if (!value) return '';
  const parsed = parseJsonObjectFromText(value);
  if (!parsed) return '';
  const diff = isPlainRecord(parsed.diff) ? parsed.diff : parsed;
  const diffs = Array.isArray(diff.diffs) ? diff.diffs : [diff];
  return diffs
    .map(unifiedDiffFromToolDiff)
    .filter(Boolean)
    .join('\n');
}

function unifiedDiffFromToolDiff(value: unknown): string {
  if (!isPlainRecord(value)) return '';
  const filePath = typeof value.path === 'string' ? value.path.trim() : '';
  if (!filePath) return '';
  const diffText = diffTextFromToolPreviewLines(value.lines);
  if (!diffText) return '';
  const action = typeof value.action === 'string' ? value.action.toLowerCase() : '';
  const isCreate = action.includes('create') || action.includes('add');
  const isDelete = action.includes('delete') || action.includes('remove');
  const oldPath = isCreate ? '/dev/null' : `a/${filePath}`;
  const newPath = isDelete ? '/dev/null' : `b/${filePath}`;
  return [`diff --git a/${filePath} b/${filePath}`, `--- ${oldPath}`, `+++ ${newPath}`, diffText].join('\n');
}

function diffTextFromToolPreviewLines(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((line) => {
      if (!isPlainRecord(line)) return '';
      const content = typeof line.content === 'string' ? line.content : '';
      if (line.type === 'add' || line.type === 'added') return `+${content}`;
      if (line.type === 'del' || line.type === 'delete' || line.type === 'removed') return `-${content}`;
      if (line.type === 'gap') return '...';
      return ` ${content}`;
    })
    .filter(Boolean)
    .join('\n');
}
