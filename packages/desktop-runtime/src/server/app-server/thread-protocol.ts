import type {
  RuntimeGitInfo,
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadGoal,
  RuntimeThreadGoalStatus,
  RuntimeThreadMemoryMode,
  SweTurn,
} from '@setsuna-desktop/contracts';
import { runtimeThreadToSweTurns } from '@setsuna-desktop/contracts';
import { randomRuntimeId } from '../runtime-ids.js';
import { toUnixSeconds } from '../time-utils.js';
import type { RuntimeFactory, RuntimeServerOptions } from '../types.js';
import { AppServerRpcError } from './errors.js';
import { hasOwn, numericInput, recordInput, requiredRawString, requiredString, stringInput } from './input.js';
import { activeModelCode, activeModelProvider, appServerApprovalPolicy, sweSandboxPolicy } from './config-protocol.js';

export function sweThreadFromRuntimeSummary(
  thread: RuntimeThread | Pick<RuntimeThread, 'id' | 'forkedFromId' | 'parentThreadId' | 'title' | 'createdAt' | 'updatedAt' | 'lastMessagePreview' | 'archived' | 'gitInfo'>,
  cwd: string,
  options: RuntimeServerOptions,
) {
  const createdAt = toUnixSeconds(thread.createdAt);
  const updatedAt = toUnixSeconds(thread.updatedAt);
  return {
    id: thread.id,
    sessionId: thread.id,
    forkedFromId: thread.forkedFromId ?? null,
    parentThreadId: thread.parentThreadId ?? null,
    preview: thread.lastMessagePreview,
    ephemeral: false,
    modelProvider: 'setsuna',
    createdAt,
    updatedAt,
    recencyAt: updatedAt,
    status: { type: 'notLoaded' },
    path: null,
    cwd,
    cliVersion: options.version,
    source: 'appServer',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: thread.gitInfo ? { ...thread.gitInfo } : null,
    name: thread.title,
    turns: [],
  };
}

export function sweThreadFromRuntimeThread(thread: RuntimeThread, cwd: string, options: RuntimeServerOptions, includeTurns = false) {
  return {
    ...sweThreadFromRuntimeSummary(thread, cwd, options),
    status: { type: 'idle' },
    turns: includeTurns ? runtimeThreadToSweTurns(thread) : [],
  };
}

export function sweThreadSessionResponse(
  thread: RuntimeThread,
  cwd: string,
  config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>,
  options: RuntimeServerOptions,
  includeTurns = false,
) {
  return {
    thread: sweThreadFromRuntimeThread(thread, cwd, options, includeTurns),
    model: activeModelCode(config),
    modelProvider: activeModelProvider(config),
    serviceTier: null,
    cwd,
    instructionSources: [],
    approvalPolicy: appServerApprovalPolicy(config.approvalPolicy),
    approvalsReviewer: 'user',
    sandbox: sweSandboxPolicy(config.permissionProfile, cwd),
    reasoningEffort: null,
  };
}

type AppServerSettableThreadMemoryMode = Extract<RuntimeThreadMemoryMode, 'enabled' | 'disabled'>;

export function sweThreadMemoryModeSetInput(value: unknown): { threadId: string; mode: AppServerSettableThreadMemoryMode } {
  const input = recordInput(value);
  return {
    threadId: requiredString(input.threadId ?? input.thread_id, 'threadId'),
    mode: sweSettableThreadMemoryMode(input.mode),
  };
}

function sweSettableThreadMemoryMode(value: unknown): AppServerSettableThreadMemoryMode {
  if (value === 'enabled' || value === 'disabled') return value;
  throw new AppServerRpcError(-32602, 'mode must be enabled or disabled');
}

type AppServerSortDirection = 'asc' | 'desc';
type AppServerTurnItemsView = SweTurn['itemsView'];
type AppServerThreadItem = SweTurn['items'][number];

type AppServerThreadTurnsCursor = {
  turnId: string;
  includeAnchor: boolean;
};

type AppServerThreadItemsCursor = {
  turnId: string;
  itemId: string;
  includeAnchor: boolean;
};

type AppServerThreadItemEntry = {
  index: number;
  item: AppServerThreadItem;
  turnId: string;
};
export function sweInitialTurnsPage(thread: RuntimeThread, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const page = sweThreadTurnsListResponse(thread, recordInput(value));
  return {
    data: page.data,
    nextCursor: page.nextCursor,
    backwardsCursor: page.backwardsCursor,
  };
}

export function sweThreadTurnsListResponse(thread: RuntimeThread, input: Record<string, unknown>) {
  const turns = runtimeThreadToSweTurns(thread);
  const viewedTurns = sweTurnsWithItemsView(turns, sweTurnItemsView(input.itemsView));
  return sweTurnPage(
    viewedTurns,
    stringInput(input.cursor),
    numericInput(input.limit),
    sweSortDirection(input.sortDirection),
  );
}

export function sweThreadItemsListResponse(thread: RuntimeThread, input: Record<string, unknown>) {
  const turnIdFilter = stringInput(input.turnId ?? input.turn_id);
  const entries = runtimeThreadToSweTurns(thread).flatMap((turn) => {
    if (turnIdFilter && turn.id !== turnIdFilter) return [];
    return turn.items.map((item, itemIndex) => ({
      index: itemIndex,
      item,
      turnId: turn.id,
    }));
  });
  return sweThreadItemPage(
    entries.map((entry, index) => ({ ...entry, index })),
    stringInput(input.cursor),
    numericInput(input.limit),
    sweSortDirection(input.sortDirection ?? input.sort_direction, 'asc'),
  );
}

function sweTurnPage(
  turns: SweTurn[],
  cursor: string | undefined,
  limit: number | undefined,
  sortDirection: AppServerSortDirection,
) {
  if (!turns.length) return { data: [], nextCursor: null, backwardsCursor: null };

  const anchor = cursor ? sweParseTurnCursor(cursor) : null;
  const anchorIndex = anchor ? turns.findIndex((turn) => turn.id === anchor.turnId) : -1;
  if (anchor && anchorIndex < 0) {
    throw new AppServerRpcError(-32600, 'invalid cursor: anchor turn is no longer present');
  }

  const pageSize = Math.min(100, Math.max(1, Math.trunc(limit ?? 25)));
  let keyedTurns = turns.map((turn, index) => ({ index, turn }));
  if (sortDirection === 'desc') keyedTurns = keyedTurns.reverse();

  if (anchor) {
    keyedTurns = keyedTurns.filter(({ index }) => {
      if (sortDirection === 'asc') return anchor.includeAnchor ? index >= anchorIndex : index > anchorIndex;
      return anchor.includeAnchor ? index <= anchorIndex : index < anchorIndex;
    });
  }

  const moreTurnsAvailable = keyedTurns.length > pageSize;
  const page = keyedTurns.slice(0, pageSize);
  return {
    data: page.map(({ turn }) => turn),
    nextCursor: moreTurnsAvailable ? sweSerializeTurnCursor(page.at(-1)?.turn.id, false) : null,
    backwardsCursor: page.length ? sweSerializeTurnCursor(page[0].turn.id, true) : null,
  };
}

function sweThreadItemPage(
  entries: AppServerThreadItemEntry[],
  cursor: string | undefined,
  limit: number | undefined,
  sortDirection: AppServerSortDirection,
) {
  if (!entries.length) return { data: [], nextCursor: null, backwardsCursor: null };

  const anchor = cursor ? sweParseItemCursor(cursor) : null;
  const anchorIndex = anchor ? entries.findIndex((entry) => entry.turnId === anchor.turnId && entry.item.id === anchor.itemId) : -1;
  if (anchor && anchorIndex < 0) {
    throw new AppServerRpcError(-32600, 'invalid cursor: anchor item is no longer present');
  }

  const pageSize = Math.min(100, Math.max(1, Math.trunc(limit ?? 25)));
  let keyedItems = [...entries];
  if (sortDirection === 'desc') keyedItems = keyedItems.reverse();

  if (anchor) {
    keyedItems = keyedItems.filter((entry) => {
      if (sortDirection === 'asc') return anchor.includeAnchor ? entry.index >= anchorIndex : entry.index > anchorIndex;
      return anchor.includeAnchor ? entry.index <= anchorIndex : entry.index < anchorIndex;
    });
  }

  const moreItemsAvailable = keyedItems.length > pageSize;
  const page = keyedItems.slice(0, pageSize);
  return {
    data: page.map((entry) => entry.item),
    nextCursor: moreItemsAvailable ? sweSerializeItemCursor(page.at(-1), false) : null,
    backwardsCursor: page.length ? sweSerializeItemCursor(page[0], true) : null,
  };
}

function sweTurnsWithItemsView(turns: SweTurn[], itemsView: AppServerTurnItemsView): SweTurn[] {
  return turns.map((turn) => {
    if (itemsView === 'full') return { ...turn, items: [...turn.items], itemsView };
    if (itemsView === 'notLoaded') return { ...turn, items: [], itemsView };
    return { ...turn, items: sweSummaryTurnItems(turn.items), itemsView };
  });
}

function sweSummaryTurnItems(items: AppServerThreadItem[]): AppServerThreadItem[] {
  const firstUserMessage = items.find((item) => item.type === 'userMessage');
  const finalAgentMessage = [...items].reverse().find((item) => item.type === 'agentMessage');
  if (firstUserMessage && finalAgentMessage && firstUserMessage.id !== finalAgentMessage.id) {
    return [firstUserMessage, finalAgentMessage];
  }
  if (firstUserMessage) return [firstUserMessage];
  if (finalAgentMessage) return [finalAgentMessage];
  return [];
}

function sweTurnItemsView(value: unknown): AppServerTurnItemsView {
  if (value === 'notLoaded' || value === 'summary' || value === 'full') return value;
  return 'summary';
}

function sweSortDirection(value: unknown, fallback: AppServerSortDirection = 'desc'): AppServerSortDirection {
  if (value === 'asc' || value === 'desc') return value;
  return fallback;
}

function sweSerializeTurnCursor(turnId: string | undefined, includeAnchor: boolean): string | null {
  return turnId ? JSON.stringify({ turnId, includeAnchor }) : null;
}

function sweSerializeItemCursor(entry: AppServerThreadItemEntry | undefined, includeAnchor: boolean): string | null {
  return entry ? JSON.stringify({ turnId: entry.turnId, itemId: entry.item.id, includeAnchor }) : null;
}

function sweParseTurnCursor(cursor: string): AppServerThreadTurnsCursor {
  try {
    const value = JSON.parse(cursor) as unknown;
    const record = recordInput(value);
    const turnId = stringInput(record.turnId);
    if (!turnId || typeof record.includeAnchor !== 'boolean') throw new Error('invalid cursor');
    return { turnId, includeAnchor: record.includeAnchor };
  } catch {
    throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  }
}

function sweParseItemCursor(cursor: string): AppServerThreadItemsCursor {
  try {
    const value = JSON.parse(cursor) as unknown;
    const record = recordInput(value);
    const turnId = stringInput(record.turnId);
    const itemId = stringInput(record.itemId);
    if (!turnId || !itemId || typeof record.includeAnchor !== 'boolean') throw new Error('invalid cursor');
    return { turnId, itemId, includeAnchor: record.includeAnchor };
  } catch {
    throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  }
}
export function sweLoadedThreadListResponse(threadIds: string[], cursor?: string, limit?: number) {
  const data = [...threadIds].sort();
  const start = cursor ? insertionIndexAfterCursor(data, cursor) : 0;
  const defaultLimit = data.length || 1;
  const effectiveLimit = Math.max(1, Math.trunc(limit ?? defaultLimit));
  const end = Math.min(data.length, start + effectiveLimit);
  const page = data.slice(start, end);
  return {
    data: page,
    nextCursor: end < data.length ? page.at(-1) ?? null : null,
  };
}

function insertionIndexAfterCursor(sortedValues: string[], cursor: string): number {
  const found = sortedValues.indexOf(cursor);
  if (found >= 0) return found + 1;
  const insertionIndex = sortedValues.findIndex((value) => value > cursor);
  return insertionIndex >= 0 ? insertionIndex : sortedValues.length;
}

export function sweTurn(
  id: string,
  status: 'inProgress' | 'completed' | 'failed' | 'interrupted',
  options: { items?: AppServerThreadItem[]; itemsView?: AppServerTurnItemsView } = {},
) {
  return {
    id,
    items: options.items ?? [],
    itemsView: options.itemsView ?? 'full',
    status,
    error: null,
    startedAt: null,
    completedAt: status === 'inProgress' ? null : Math.floor(Date.now() / 1000),
    durationMs: null,
  };
}
export function sweUserInputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      const record = recordInput(item);
      return stringInput(record.text) || stringInput(record.value) || stringInput(record.content);
    })
    .filter(Boolean)
    .join('\n');
}

export function sweReviewRequestFromTarget(value: unknown): { displayText: string; prompt: string } {
  const target = recordInput(value);
  const type = requiredString(target.type, 'target.type');
  if (type === 'uncommittedChanges') {
    return {
      displayText: 'current changes',
      prompt: sweReviewPrompt('Review the current uncommitted changes.'),
    };
  }
  if (type === 'baseBranch') {
    const branch = stringInput(target.branch);
    if (!branch) throw new AppServerRpcError(-32600, 'branch must not be empty');
    return {
      displayText: `changes against '${branch}'`,
      prompt: sweReviewPrompt(`Review the changes between the current branch and '${branch}'.`),
    };
  }
  if (type === 'commit') {
    const sha = stringInput(target.sha);
    if (!sha) throw new AppServerRpcError(-32600, 'sha must not be empty');
    const title = stringInput(target.title);
    const shortSha = [...sha].slice(0, 7).join('');
    const displayText = title ? `commit ${shortSha}: ${title}` : `commit ${shortSha}`;
    return {
      displayText,
      prompt: sweReviewPrompt(title ? `Review commit ${sha}: ${title}.` : `Review commit ${sha}.`),
    };
  }
  if (type === 'custom') {
    const instructions = stringInput(target.instructions);
    if (!instructions) throw new AppServerRpcError(-32600, 'instructions must not be empty');
    return { displayText: instructions, prompt: instructions };
  }
  throw new AppServerRpcError(-32602, `Unsupported review target: ${type}`);
}

function sweReviewPrompt(scope: string): string {
  return [
    scope,
    'Find bugs, regressions, security issues, and missing tests. Report findings first, ordered by severity, with file and line references when possible.',
    'If there are no actionable findings, say so briefly and mention any residual risk.',
  ].join('\n');
}

export function sweReviewUserMessageItem(id: string, text: string): AppServerThreadItem {
  return { type: 'userMessage', id, clientId: null, content: [{ type: 'text', text }] };
}

export function sweClientUserMessageId(input: Record<string, unknown>): string | undefined {
  return stringInput(input.clientUserMessageId ?? input.client_user_message_id);
}

export function sweSetThreadGoal(thread: RuntimeThread, input: Record<string, unknown>): RuntimeThreadGoal {
  const hasObjective = Object.prototype.hasOwnProperty.call(input, 'objective') && input.objective !== null;
  const objective = hasObjective ? normalizeAppServerGoalObjective(input.objective) : thread.goal?.objective;
  if (!objective) throw new AppServerRpcError(-32602, `cannot update goal for thread ${thread.id}: no goal exists`);

  const status = hasOwn(input, 'status') && input.status !== null
    ? sweGoalStatus(input.status)
    : thread.goal?.status ?? 'active';
  const tokenBudget = hasOwn(input, 'tokenBudget')
    ? sweGoalTokenBudget(input.tokenBudget)
    : thread.goal?.tokenBudget ?? null;
  const now = Math.floor(Date.now() / 1000);
  return {
    threadId: thread.id,
    objective,
    status,
    tokenBudget,
    tokensUsed: thread.goal?.tokensUsed ?? 0,
    timeUsedSeconds: thread.goal?.timeUsedSeconds ?? 0,
    createdAt: thread.goal?.createdAt ?? now,
    updatedAt: now,
  };
}

function normalizeAppServerGoalObjective(value: unknown): string {
  if (typeof value !== 'string') throw new AppServerRpcError(-32602, 'goal objective must be a string');
  const objective = value.trim();
  if (!objective) throw new AppServerRpcError(-32602, 'goal objective must not be empty');
  if ([...objective].length > 4000) throw new AppServerRpcError(-32602, 'goal objective must be at most 4000 characters');
  return objective;
}

function sweGoalStatus(value: unknown): RuntimeThreadGoalStatus {
  if (
    value === 'active' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'usageLimited' ||
    value === 'budgetLimited' ||
    value === 'complete'
  ) {
    return value;
  }
  throw new AppServerRpcError(-32602, `Unsupported goal status: ${String(value)}`);
}

function sweGoalTokenBudget(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AppServerRpcError(-32602, 'goal budgets must be positive when provided');
  }
  return value;
}

export function swePatchThreadGitInfo(thread: RuntimeThread, input: Record<string, unknown>): RuntimeGitInfo | null {
  const gitInfo = recordInput(input.gitInfo);
  const hasGitInfo = input.gitInfo && typeof input.gitInfo === 'object' && !Array.isArray(input.gitInfo);
  if (!hasGitInfo || (!hasOwn(gitInfo, 'sha') && !hasOwn(gitInfo, 'branch') && !hasOwn(gitInfo, 'originUrl'))) {
    throw new AppServerRpcError(-32602, 'gitInfo must include at least one field');
  }

  const current = thread.gitInfo ?? { sha: null, branch: null, originUrl: null };
  const next: RuntimeGitInfo = {
    sha: hasOwn(gitInfo, 'sha') ? sweGitInfoField(gitInfo.sha, 'gitInfo.sha') : current.sha,
    branch: hasOwn(gitInfo, 'branch') ? sweGitInfoField(gitInfo.branch, 'gitInfo.branch') : current.branch,
    originUrl: hasOwn(gitInfo, 'originUrl') ? sweGitInfoField(gitInfo.originUrl, 'gitInfo.originUrl') : current.originUrl,
  };
  return next.sha || next.branch || next.originUrl ? next : null;
}

function sweGitInfoField(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AppServerRpcError(-32602, `${name} must be a string or null`);
  const text = value.trim();
  if (!text) throw new AppServerRpcError(-32602, `${name} must not be empty`);
  return text;
}

export function sweInjectedResponseItemsToRuntimeMessages(items: unknown[]): RuntimeMessage[] {
  return items.map((item, index) => sweInjectedResponseItemToRuntimeMessage(item, index));
}

function sweInjectedResponseItemToRuntimeMessage(item: unknown, index: number): RuntimeMessage {
  const record = recordInput(item);
  const type = stringInput(record.type);
  if (type === 'message') return sweInjectedMessageToRuntimeMessage(record, index);
  if (type === 'function_call') return sweInjectedFunctionCallToRuntimeMessage(record, index);
  if (type === 'function_call_output') return sweInjectedFunctionCallOutputToRuntimeMessage(record, index);
  throw new AppServerRpcError(-32602, `items[${index}] is not a supported response item: ${type ?? 'unknown'}`);
}

function sweInjectedMessageToRuntimeMessage(item: Record<string, unknown>, index: number): RuntimeMessage {
  const role = sweInjectedMessageRole(requiredString(item.role, `items[${index}].role`), index);
  const parsed = sweInjectedMessageContent(item.content, index);
  return {
    id: stringInput(item.id) || randomRuntimeId('msg_injected'),
    role,
    content: parsed.text,
    attachments: parsed.attachments.length ? parsed.attachments : undefined,
    createdAt: new Date().toISOString(),
    status: 'complete',
    visibility: 'model',
  };
}

function sweInjectedFunctionCallToRuntimeMessage(item: Record<string, unknown>, index: number): RuntimeMessage {
  const callId = requiredString(item.call_id, `items[${index}].call_id`);
  return {
    id: stringInput(item.id) || randomRuntimeId('msg_injected'),
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    status: 'complete',
    visibility: 'model',
    toolCalls: [{
      id: callId,
      name: requiredString(item.name, `items[${index}].name`),
      arguments: sweInjectedFunctionArguments(item.arguments),
    }],
  };
}

function sweInjectedFunctionCallOutputToRuntimeMessage(item: Record<string, unknown>, index: number): RuntimeMessage {
  const callId = requiredString(item.call_id, `items[${index}].call_id`);
  return {
    id: stringInput(item.id) || randomRuntimeId('msg_injected'),
    role: 'tool',
    content: sweInjectedFunctionOutputText(item.output),
    createdAt: new Date().toISOString(),
    status: 'complete',
    visibility: 'model',
    toolCallId: callId,
  };
}

function sweInjectedMessageRole(role: string, index: number): RuntimeMessage['role'] {
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  if (role === 'developer') return 'system';
  throw new AppServerRpcError(-32602, `items[${index}].role is not supported: ${role}`);
}

function sweInjectedMessageContent(content: unknown, index: number): { attachments: NonNullable<RuntimeMessage['attachments']>; text: string } {
  if (typeof content === 'string') return { attachments: [], text: content };
  if (!Array.isArray(content)) throw new AppServerRpcError(-32602, `items[${index}].content must be an array`);
  const attachments: NonNullable<RuntimeMessage['attachments']> = [];
  const textParts: string[] = [];
  for (const [partIndex, part] of content.entries()) {
    if (typeof part === 'string') {
      textParts.push(part);
      continue;
    }
    const record = recordInput(part);
    const type = stringInput(record.type);
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      textParts.push(requiredRawString(record.text, `items[${index}].content[${partIndex}].text`));
      continue;
    }
    if (type === 'input_image') {
      const url = requiredString(record.image_url, `items[${index}].content[${partIndex}].image_url`);
      attachments.push({
        id: randomRuntimeId('attachment_injected'),
        name: 'Injected image',
        type: 'image/*',
        size: 0,
        url,
      });
      continue;
    }
    throw new AppServerRpcError(-32602, `items[${index}].content[${partIndex}] is not supported: ${type ?? 'unknown'}`);
  }
  return { attachments, text: textParts.join('\n') };
}

function sweInjectedFunctionArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function sweInjectedFunctionOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output
      .map((item) => {
        if (typeof item === 'string') return item;
        const record = recordInput(item);
        return typeof record.text === 'string' ? record.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  const record = recordInput(output);
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.content)) return sweInjectedFunctionOutputText(record.content);
  return output === undefined || output === null ? '' : JSON.stringify(output);
}
