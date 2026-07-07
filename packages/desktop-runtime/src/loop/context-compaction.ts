import type { RuntimeContextCompactionNotice, RuntimeMessage } from '@setsuna-desktop/contracts';

export const CONTEXT_COMPACTION_MAX_TOKENS_K = 256;
export const CONTEXT_COMPACTION_MAX_TOKENS = CONTEXT_COMPACTION_MAX_TOKENS_K * 1000;

const APPROX_CHARS_PER_TOKEN = 4;
const AUTO_COMPACT_TOKEN_LIMIT_RATIO = 0.85;
// 这里用字符数估算 token，只用于触发压缩和 UI 百分比，不作为精确计费依据。
const COMPACTED_CONTEXT_TARGET_RATIO_DIVISOR = 4;
// 保留最近消息原文，避免最新用户意图和最近工具结果被摘要改写。
const DEFAULT_KEEP_RECENT_MESSAGES = 8;

export type RuntimeContextCompactionResult = {
  messages: RuntimeMessage[];
  notice: RuntimeContextCompactionNotice;
};

export type RuntimeContextCompactionCandidate = {
  autoCompactTokenLimit: number;
  historyTokens: number;
  maxContextTokens: number;
  maxContextTokensK: number;
  olderMessages: RuntimeMessage[];
  originalTokens: number;
  recentMessages: RuntimeMessage[];
  targetContextTokens: number;
  triggerScopes: string[];
};

export type RuntimeContextTokenUsage = {
  autoCompactTokenLimit: number;
  maxContextTokens: number;
  maxContextTokensK: number;
  percent: number;
  tokensUntilCompaction: number;
  usedTokens: number;
};

export type RuntimeContextCompactionBudget = {
  autoCompactTokenLimit?: number;
  maxContextTokens?: number;
};

/**
 * 估算当前消息窗口的上下文用量。
 *
 * @param messages 需要估算的 runtime 消息列表。
 */
export function runtimeContextTokenUsageForMessages(messages: RuntimeMessage[], budget?: RuntimeContextCompactionBudget): RuntimeContextTokenUsage {
  const normalizedBudget = normalizeRuntimeContextCompactionBudget(budget);
  const usedTokens = estimateRuntimeMessageTokens(messages);
  return {
    autoCompactTokenLimit: normalizedBudget.autoCompactTokenLimit,
    maxContextTokens: normalizedBudget.maxContextTokens,
    maxContextTokensK: maxContextTokensK(normalizedBudget.maxContextTokens),
    percent: percentForTokens(usedTokens, normalizedBudget.autoCompactTokenLimit),
    tokensUntilCompaction: Math.max(0, normalizedBudget.autoCompactTokenLimit - usedTokens),
    usedTokens,
  };
}

/**
 * 选择可摘要的较早模型上下文，同时保留最近尾部消息原文。
 *
 * @param force 是否忽略 token 阈值强制生成候选。
 * @param keepRecentMessages 需要原样保留的最近模型可见消息数量。
 * @param messages 当前线程消息列表。
 */
export function createRuntimeContextCompactionCandidate({
  budget,
  force = false,
  keepRecentMessages = DEFAULT_KEEP_RECENT_MESSAGES,
  messages,
}: {
  budget?: RuntimeContextCompactionBudget;
  force?: boolean;
  keepRecentMessages?: number;
  messages: RuntimeMessage[];
}): RuntimeContextCompactionCandidate | null {
  const normalizedBudget = normalizeRuntimeContextCompactionBudget(budget);
  const originalTokens = estimateRuntimeMessageTokens(messages);
  if (!force && originalTokens <= normalizedBudget.autoCompactTokenLimit) return null;

  // 只用模型可见消息计算切分点，transcript-only 历史不会重新进入 prompt。
  const eligibleIndexes = messages
    .map((message, index) => (messageEligibleForCompaction(message) ? index : -1))
    .filter((index) => index >= 0);
  const tailScope = compactableTailScope(messages, eligibleIndexes, normalizedBudget.autoCompactTokenLimit);
  if (eligibleIndexes.length <= 1 && !tailScope) return null;

  const targetContextTokens = compactedContextTargetTokens(originalTokens, normalizedBudget.autoCompactTokenLimit);
  const minKeepCount = tailScope ? 0 : 1;
  let keepCount = Math.min(Math.max(minKeepCount, keepRecentMessages), Math.max(minKeepCount, eligibleIndexes.length - 1));
  let recentStart = recentStartForKeepCount(eligibleIndexes, keepCount, messages.length);
  let olderMessages = messages.slice(0, recentStart);
  let recentMessages = messages.slice(recentStart);
  // 工具结果可能单条就撑爆窗口；这种情况下继续固定保留最近 8 条会让 mid-turn 压缩无效。
  while (keepCount > minKeepCount && estimateRuntimeMessageTokens(recentMessages) > normalizedBudget.autoCompactTokenLimit) {
    keepCount -= 1;
    recentStart = recentStartForKeepCount(eligibleIndexes, keepCount, messages.length);
    olderMessages = messages.slice(0, recentStart);
    recentMessages = messages.slice(recentStart);
  }
  // 没有实际上下文价值时不生成空摘要，避免污染线程历史。
  if (!olderMessages.some(messageHasContextValue)) return null;

  const historyTokens = estimateRuntimeMessageTokens(olderMessages);
  return {
    autoCompactTokenLimit: normalizedBudget.autoCompactTokenLimit,
    historyTokens,
    maxContextTokens: normalizedBudget.maxContextTokens,
    maxContextTokensK: maxContextTokensK(normalizedBudget.maxContextTokens),
    olderMessages: olderMessages.map(cloneRuntimeMessage),
    originalTokens,
    recentMessages: recentMessages.map(cloneRuntimeMessage),
    targetContextTokens,
    triggerScopes: compactionTriggerScopes(force, tailScope),
  };
}

/**
 * 将模型窗口替换为 transcript 归档、一条 system 摘要和未改写的最近消息。
 *
 * @param candidate 上一步选出的压缩候选。
 * @param createdAt 摘要消息和 notice 的创建时间。
 * @param id 摘要 system message 的消息 ID。
 * @param summary 压缩模型生成的摘要文本。
 * @param turnId 触发压缩的 turn ID。
 */
export function materializeRuntimeContextCompaction({
  candidate,
  createdAt,
  id,
  summary,
  source = 'local',
  turnId,
}: {
  candidate: RuntimeContextCompactionCandidate;
  createdAt: string;
  id: string;
  summary: string;
  source?: RuntimeContextCompactionNotice['source'];
  turnId?: string;
}): RuntimeContextCompactionResult {
  const normalizedSummary = summary.trim();
  const compactedMessageCount = candidate.olderMessages.filter(messageHasContextValue).length;
  // 旧消息仍保留给用户看，但标记为 transcript 后不会再进入后续模型请求。
  const archivedMessages = candidate.olderMessages
    .filter((message) => message.visibility !== 'model')
    .map(cloneTranscriptMessage);
  const summaryTokens = estimateStringTokens(normalizedSummary);
  const compactedTokens = summaryTokens + estimateRuntimeMessageTokens(candidate.recentMessages);
  const tokensUntilCompaction = Math.max(0, candidate.autoCompactTokenLimit - compactedTokens);

  const notice: RuntimeContextCompactionNotice = {
    autoCompactTokenLimit: candidate.autoCompactTokenLimit,
    compactedMessageCount,
    compactedRequestTokens: compactedTokens,
    compactedTokens,
    forced: candidate.triggerScopes.includes('manual') || undefined,
    historyTokens: candidate.historyTokens,
    keptRecentMessageCount: candidate.recentMessages.length,
    maxContextTokens: candidate.maxContextTokens,
    maxContextTokensK: candidate.maxContextTokensK,
    message: '正在智能压缩上下文',
    originalMessageCount: compactedMessageCount + candidate.recentMessages.filter(messageHasContextValue).length,
    originalRequestTokens: candidate.originalTokens,
    originalTokens: candidate.originalTokens,
    scope: candidate.triggerScopes[0],
    source,
    summaryRole: 'system',
    summaryTokens,
    targetContextTokens: candidate.targetContextTokens,
    tokensUntilCompaction,
    triggerScopes: candidate.triggerScopes,
  };

  const summaryMessage: RuntimeMessage = {
    id,
    ...(turnId ? { turnId } : {}),
    role: 'system',
    content: `<context_compaction_summary max_context_tokens_k="${candidate.maxContextTokensK}" compacted_messages="${candidate.olderMessages.length}">\n${normalizedSummary}\n</context_compaction_summary>`,
    createdAt,
    status: 'complete',
    contextCompaction: notice,
  };

  // 返回的 messages 是新的线程投影：旧 transcript + 摘要 + 最近原文。
  return {
    messages: [...archivedMessages, summaryMessage, ...candidate.recentMessages.map(cloneRuntimeMessage)],
    notice,
  };
}

function compactedContextTargetTokens(originalTokens: number, maxTokens: number): number {
  const ratioTarget = Math.max(1, Math.ceil(originalTokens / COMPACTED_CONTEXT_TARGET_RATIO_DIVISOR));
  return Math.min(maxTokens, ratioTarget);
}

function normalizeRuntimeContextCompactionBudget(budget?: RuntimeContextCompactionBudget): Required<RuntimeContextCompactionBudget> {
  const maxContextTokens = positiveInt(budget?.maxContextTokens) ?? CONTEXT_COMPACTION_MAX_TOKENS;
  const defaultAutoLimit = Math.max(1, Math.floor(maxContextTokens * AUTO_COMPACT_TOKEN_LIMIT_RATIO));
  const autoCompactTokenLimit = Math.min(maxContextTokens, positiveInt(budget?.autoCompactTokenLimit) ?? defaultAutoLimit);
  return { autoCompactTokenLimit, maxContextTokens };
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function maxContextTokensK(maxContextTokens: number): number {
  return Math.max(1, Math.round(maxContextTokens / 1000));
}

function percentForTokens(usedTokens: number, maxTokens: number): number {
  if (maxTokens <= 0 || usedTokens <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((usedTokens / maxTokens) * 100)));
}

function recentStartForKeepCount(eligibleIndexes: number[], keepCount: number, messagesLength: number): number {
  if (keepCount <= 0) return messagesLength;
  return eligibleIndexes[eligibleIndexes.length - keepCount] ?? messagesLength;
}

function compactableTailScope(messages: RuntimeMessage[], eligibleIndexes: number[], autoCompactTokenLimit: number): string | null {
  const last = messages[eligibleIndexes[eligibleIndexes.length - 1] ?? -1];
  // 保留最新用户意图很重要；但最新工具输出可以被摘要替代，否则超大工具结果会反复撑爆窗口。
  if (last?.role === 'tool') return 'latest_tool';
  // 如果最新纯文本用户输入单条就超过预算，继续保留原文会导致 steer/用户长输入无法恢复地爆窗。
  if (
    last?.role === 'user'
    && !last.attachments?.length
    && last.content.trim()
    && estimateMessageTokens(last) > autoCompactTokenLimit
  ) {
    return 'latest_input';
  }
  return null;
}

function compactionTriggerScopes(force: boolean, tailScope: string | null): string[] {
  if (force) return ['manual'];
  return tailScope ? ['total', tailScope] : ['total'];
}

/**
 * 估算消息列表的 token 数。
 *
 * @param messages 需要估算的 runtime 消息列表。
 */
export function estimateRuntimeMessageTokens(messages: RuntimeMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function estimateMessageTokens(message: RuntimeMessage): number {
  if (message.visibility === 'transcript') return 0;
  const attachmentTokens = (message.attachments ?? []).reduce((total, attachment) => {
    if (!attachment.url.startsWith('data:')) return total + estimateStringTokens(`${attachment.name} ${attachment.type}`);
    return total + estimateStringTokens(attachment.url);
  }, 0);
  return estimateStringTokens(`${message.role}\n${message.content}`) + attachmentTokens;
}

function estimateStringTokens(value: string): number {
  return Math.ceil(value.length / APPROX_CHARS_PER_TOKEN);
}

function messageHasContextValue(message: RuntimeMessage): boolean {
  if (message.visibility === 'transcript') return false;
  return Boolean(message.content.trim() || message.attachments?.length || message.contextCompaction);
}

function messageEligibleForCompaction(message: RuntimeMessage): boolean {
  // 普通 system prompt 不压缩；只有历史压缩摘要这种 system 消息允许再次被合并。
  return message.visibility !== 'transcript' && (message.role !== 'system' || Boolean(message.contextCompaction));
}

function cloneTranscriptMessage(message: RuntimeMessage): RuntimeMessage {
  // clone 时显式降级 visibility，防止后续 reducer 误把旧消息重新喂给模型。
  return {
    ...cloneRuntimeMessage(message),
    visibility: 'transcript',
  };
}

function cloneRuntimeMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    contextCompaction: message.contextCompaction ? { ...message.contextCompaction } : undefined,
    planMode: message.planMode ? { ...message.planMode } : undefined,
    reviewMode: message.reviewMode ? { ...message.reviewMode } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map((toolRun) => ({ ...toolRun })),
  };
}
