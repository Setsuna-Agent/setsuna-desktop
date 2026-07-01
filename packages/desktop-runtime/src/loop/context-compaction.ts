import type { RuntimeContextCompactionNotice, RuntimeMessage } from '@setsuna-desktop/contracts';

export const CONTEXT_COMPACTION_MAX_TOKENS_K = 256;
export const CONTEXT_COMPACTION_MAX_TOKENS = CONTEXT_COMPACTION_MAX_TOKENS_K * 1000;

const APPROX_CHARS_PER_TOKEN = 4;
// 这里用字符数估算 token，只用于触发压缩和 UI 百分比，不作为精确计费依据。
const COMPACTED_CONTEXT_TARGET_RATIO_DIVISOR = 4;
// 保留最近消息原文，避免最新用户意图和最近工具结果被摘要改写。
const DEFAULT_KEEP_RECENT_MESSAGES = 8;

export type RuntimeContextCompactionResult = {
  messages: RuntimeMessage[];
  notice: RuntimeContextCompactionNotice;
};

export type RuntimeContextCompactionCandidate = {
  historyTokens: number;
  olderMessages: RuntimeMessage[];
  originalTokens: number;
  recentMessages: RuntimeMessage[];
  targetContextTokens: number;
  triggerScopes: string[];
};

export type RuntimeContextTokenUsage = {
  maxContextTokens: number;
  maxContextTokensK: number;
  percent: number;
  usedTokens: number;
};

/**
 * 估算当前消息窗口的上下文用量。
 *
 * @param messages 需要估算的 runtime 消息列表。
 */
export function runtimeContextTokenUsageForMessages(messages: RuntimeMessage[]): RuntimeContextTokenUsage {
  const usedTokens = estimateRuntimeMessageTokens(messages);
  return {
    maxContextTokens: CONTEXT_COMPACTION_MAX_TOKENS,
    maxContextTokensK: CONTEXT_COMPACTION_MAX_TOKENS_K,
    percent: percentForTokens(usedTokens, CONTEXT_COMPACTION_MAX_TOKENS),
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
  force = false,
  keepRecentMessages = DEFAULT_KEEP_RECENT_MESSAGES,
  messages,
}: {
  force?: boolean;
  keepRecentMessages?: number;
  messages: RuntimeMessage[];
}): RuntimeContextCompactionCandidate | null {
  const originalTokens = estimateRuntimeMessageTokens(messages);
  const maxTokens = CONTEXT_COMPACTION_MAX_TOKENS;
  if (!force && originalTokens <= maxTokens) return null;

  // 只用模型可见消息计算切分点，transcript-only 历史不会重新进入 prompt。
  const eligibleIndexes = messages
    .map((message, index) => (messageEligibleForCompaction(message) ? index : -1))
    .filter((index) => index >= 0);
  if (eligibleIndexes.length <= 1) return null;

  const keepCount = Math.min(Math.max(1, keepRecentMessages), Math.max(1, eligibleIndexes.length - 1));
  const recentStart = eligibleIndexes[eligibleIndexes.length - keepCount] ?? messages.length;
  const olderMessages = messages.slice(0, recentStart);
  const recentMessages = messages.slice(recentStart);
  // 没有实际上下文价值时不生成空摘要，避免污染线程历史。
  if (!olderMessages.some(messageHasContextValue)) return null;

  const historyTokens = estimateRuntimeMessageTokens(olderMessages);
  return {
    historyTokens,
    olderMessages: olderMessages.map(cloneRuntimeMessage),
    originalTokens,
    recentMessages: recentMessages.map(cloneRuntimeMessage),
    targetContextTokens: compactedContextTargetTokens(originalTokens, maxTokens),
    triggerScopes: force ? ['manual'] : ['total'],
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
  turnId,
}: {
  candidate: RuntimeContextCompactionCandidate;
  createdAt: string;
  id: string;
  summary: string;
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

  const notice: RuntimeContextCompactionNotice = {
    compactedMessageCount,
    compactedRequestTokens: compactedTokens,
    compactedTokens,
    forced: candidate.triggerScopes.includes('manual') || undefined,
    historyTokens: candidate.historyTokens,
    keptRecentMessageCount: candidate.recentMessages.length,
    maxContextTokens: CONTEXT_COMPACTION_MAX_TOKENS,
    maxContextTokensK: CONTEXT_COMPACTION_MAX_TOKENS_K,
    message: '正在智能压缩上下文',
    originalMessageCount: compactedMessageCount + candidate.recentMessages.filter(messageHasContextValue).length,
    originalRequestTokens: candidate.originalTokens,
    originalTokens: candidate.originalTokens,
    scope: candidate.triggerScopes[0],
    summaryRole: 'system',
    summaryTokens,
    targetContextTokens: candidate.targetContextTokens,
    triggerScopes: candidate.triggerScopes,
  };

  const summaryMessage: RuntimeMessage = {
    id,
    ...(turnId ? { turnId } : {}),
    role: 'system',
    content: `<context_compaction_summary max_context_tokens_k="${CONTEXT_COMPACTION_MAX_TOKENS_K}" compacted_messages="${candidate.olderMessages.length}">\n${normalizedSummary}\n</context_compaction_summary>`,
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

function percentForTokens(usedTokens: number, maxTokens: number): number {
  if (maxTokens <= 0 || usedTokens <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((usedTokens / maxTokens) * 100)));
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
    reviewMode: message.reviewMode ? { ...message.reviewMode } : undefined,
    toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    toolRuns: message.toolRuns?.map((toolRun) => ({ ...toolRun })),
  };
}
