import type { RuntimeContextCompactionNotice, RuntimeMessage } from '@setsuna-desktop/contracts';

export const CONTEXT_COMPACTION_MAX_TOKENS_K = 256;
export const CONTEXT_COMPACTION_MAX_TOKENS = CONTEXT_COMPACTION_MAX_TOKENS_K * 1000;

const APPROX_CHARS_PER_TOKEN = 4;
const COMPACTED_CONTEXT_TARGET_RATIO_DIVISOR = 4;
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

export function runtimeContextTokenUsageForMessages(messages: RuntimeMessage[]): RuntimeContextTokenUsage {
  const usedTokens = estimateRuntimeMessageTokens(messages);
  return {
    maxContextTokens: CONTEXT_COMPACTION_MAX_TOKENS,
    maxContextTokensK: CONTEXT_COMPACTION_MAX_TOKENS_K,
    percent: percentForTokens(usedTokens, CONTEXT_COMPACTION_MAX_TOKENS),
    usedTokens,
  };
}

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

  const eligibleMessages = messages.filter((message) => message.visibility !== 'transcript' && (message.role !== 'system' || message.contextCompaction));
  if (eligibleMessages.length <= 1) return null;

  const keepCount = Math.min(Math.max(1, keepRecentMessages), Math.max(1, eligibleMessages.length - 1));
  const recentStart = Math.max(0, messages.length - keepCount);
  const olderMessages = messages.slice(0, recentStart);
  const recentMessages = messages.slice(recentStart);
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
  const summaryTokens = estimateStringTokens(normalizedSummary);
  const compactedTokens = summaryTokens + estimateRuntimeMessageTokens(candidate.recentMessages);

  const notice: RuntimeContextCompactionNotice = {
    compactedMessageCount: candidate.olderMessages.length,
    compactedRequestTokens: compactedTokens,
    compactedTokens,
    forced: candidate.triggerScopes.includes('manual') || undefined,
    historyTokens: candidate.historyTokens,
    keptRecentMessageCount: candidate.recentMessages.length,
    maxContextTokens: CONTEXT_COMPACTION_MAX_TOKENS,
    maxContextTokensK: CONTEXT_COMPACTION_MAX_TOKENS_K,
    message: '正在智能压缩上下文',
    originalMessageCount: candidate.olderMessages.length + candidate.recentMessages.length,
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

  return {
    messages: [summaryMessage, ...candidate.recentMessages.map(cloneRuntimeMessage)],
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
