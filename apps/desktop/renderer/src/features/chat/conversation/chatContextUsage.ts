import {
  isRuntimeInlineMessageAttachment,
  type RuntimeConfigState,
  type RuntimeContextCompactionNotice,
  type RuntimeMessage,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';

const DEFAULT_CONTEXT_TOKENS_K = 256;
const DEFAULT_CONTEXT_TOKENS = DEFAULT_CONTEXT_TOKENS_K * 1000;
const APPROX_CHARS_PER_TOKEN = 4;

export type ChatContextTokenUsage = {
  compactedMessageCount: number;
  percent: number;
  summaryRole?: string;
  totalTokens: number;
  triggerScopes: string[];
  usedTokens: number;
  visiblePercent: number;
};

export function contextTokenUsageFromThread(thread: RuntimeThread | null, configuredMaxContextTokens?: number): ChatContextTokenUsage {
  const notice = latestContextCompactionNotice(thread);
  const state = thread?.contextCompaction;
  const totalTokens = Math.max(
    0,
    Math.round(Number(positiveTokenLimit(configuredMaxContextTokens) ?? notice?.maxContextTokens ?? state?.maxContextTokens ?? DEFAULT_CONTEXT_TOKENS)),
  );
  const recomputedTokens = estimateRuntimeMessagesTokens(thread?.messages ?? []);
  const stateTokens = Math.round(Number(state?.usedTokens || 0));
  const noticeTokens = Math.round(Number(notice?.compactedTokens || 0));
  const usedTokens = state?.status === 'running'
    ? positiveNumber(stateTokens, recomputedTokens)
    : positiveNumber(recomputedTokens, noticeTokens, stateTokens);
  const rawPercent = totalTokens > 0 && usedTokens > 0 ? Math.min(100, (usedTokens / totalTokens) * 100) : 0;
  const percent = Math.round(rawPercent);

  return {
    compactedMessageCount: Math.round(Number(notice?.compactedMessageCount || 0)),
    percent,
    summaryRole: notice?.summaryRole,
    totalTokens,
    triggerScopes: notice?.triggerScopes ?? [],
    usedTokens,
    visiblePercent: rawPercent > 0 && rawPercent < 0.1 ? 0.1 : rawPercent,
  };
}

export function activeModelContextWindowTokens(config: RuntimeConfigState | null): number | undefined {
  if (!config) return undefined;
  const provider = config.providers.find((item) => item.id === config.activeProviderId && item.enabled)
    ?? config.providers.find((item) => item.enabled)
    ?? config.providers[0];
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  return positiveTokenLimit(model?.contextWindowTokens);
}

export function latestContextCompactionNotice(thread: RuntimeThread | null): RuntimeContextCompactionNotice | undefined {
  return thread?.contextCompaction?.notice
    ?? [...(thread?.messages ?? [])].reverse().find((message) => message.contextCompaction)?.contextCompaction;
}

export function formatTokenCount(value: number): string {
  const tokens = Math.max(0, Math.round(Number(value || 0)));
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number(millions.toFixed(millions >= 10 ? 0 : 1))}M`;
  }
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(tokens);
}

function estimateRuntimeMessagesTokens(messages: RuntimeMessage[]): number {
  if (!messages.length) return 0;
  const payload = messages
    // 压缩后的旧消息仍保留给用户查看，但 transcript 不会进入后续模型请求。
    .filter((message) => message.visibility !== 'transcript')
    .filter((message) => Boolean(message.content.trim() || message.attachments?.length || message.contextCompaction))
    .map((message) => ({
      attachments: message.attachments?.map((attachment) => ({
        name: attachment.name,
        size: attachment.size,
        type: attachment.type,
        url: isRuntimeInlineMessageAttachment(attachment)
          ? attachment.url.startsWith('data:') ? '[image-data]' : attachment.url
          : `[runtime-asset:${attachment.assetId}]`,
      })),
      content: message.contextCompaction ? stripContextTags(message.content) : message.content,
      role: message.role,
    }));
  return estimateStringTokens(JSON.stringify({ messages: payload }));
}

function estimateStringTokens(value: string): number {
  return Math.ceil(value.length / APPROX_CHARS_PER_TOKEN);
}

function positiveNumber(...values: number[]): number {
  return values.find((value) => Number.isFinite(value) && value > 0) ?? 0;
}

function positiveTokenLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function stripContextTags(value: string): string {
  return value.replace(/^<context_compaction_summary[^>]*>\n?/, '').replace(/\n?<\/context_compaction_summary>$/, '');
}
