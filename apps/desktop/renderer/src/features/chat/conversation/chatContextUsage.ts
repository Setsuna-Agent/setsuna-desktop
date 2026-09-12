import {
  isRuntimeInlineMessageAttachment,
  type RuntimeConfigState,
  type RuntimeContextCompactionNotice,
  type RuntimeMessage,
  type RuntimeModelRequestContextWindow,
  type RuntimeThread,
  type RuntimeThreadTurnStepSnapshot,
} from '@setsuna-desktop/contracts';
import { chatThreadModelSelection } from '../chatModelSelection.js';

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
  const budget = runtimeContextBudget(thread, notice);
  const compactionBudgetValid = hasCurrentCompactionBudget(thread);
  const configuredLimit = positiveTokenLimit(configuredMaxContextTokens);
  // An in-flight request owns its budget even if model settings change while it runs.
  const totalTokens = (thread?.activeTurnId ? budget?.maxContextTokens : undefined)
    ?? configuredLimit ?? budget?.maxContextTokens
    ?? notice?.maxContextTokens ?? state?.maxContextTokens ?? DEFAULT_CONTEXT_TOKENS;
  // Request snapshots include prompts, tool schemas, replay metadata and output reserve.
  // Recounting the paged transcript loses that budget and makes compaction look like a jump.
  const usedTokens = budget?.estimatedTokens ?? positiveNumber(
    estimateRuntimeMessagesTokens(thread?.messages ?? []),
    compactionBudgetValid ? notice?.compactedTokens ?? 0 : 0,
    compactionBudgetValid ? state?.usedTokens ?? 0 : 0,
  );
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

type ContextBudget = Pick<RuntimeModelRequestContextWindow, 'estimatedTokens' | 'maxContextTokens'>;

function runtimeContextBudget(
  thread: RuntimeThread | null,
  notice: RuntimeContextCompactionNotice | undefined,
): ContextBudget | undefined {
  const step = latestContextStep(thread);
  const window = step?.snapshot.contextWindow;
  const state = thread?.contextCompaction;
  if (!hasCurrentCompactionBudget(thread)) return window;
  if (state?.status === 'running' && state.usedTokens !== undefined) {
    const maxContextTokens = state.maxContextTokens ?? window?.maxContextTokens ?? DEFAULT_CONTEXT_TOKENS;
    return {
      estimatedTokens: state.usedTokens,
      maxContextTokens,
    };
  }

  const completedAt = state?.completedAt
    ?? [...(thread?.messages ?? [])].reverse().find((message) => message.contextCompaction)?.createdAt;
  // Compaction commits before the next sampling snapshot. Use its complete request
  // budget immediately, then let the next request take over as context grows again.
  if (notice?.compactedRequestTokens !== undefined && (!step || (completedAt && completedAt > step.createdAt))) {
    return {
      estimatedTokens: notice.compactedRequestTokens,
      maxContextTokens: notice.maxContextTokens ?? notice.maxContextTokensK * 1000,
    };
  }
  return window;
}

function latestContextStep(thread: RuntimeThread | null): RuntimeThreadTurnStepSnapshot | undefined {
  let latest: RuntimeThreadTurnStepSnapshot | undefined;
  for (const turn of thread?.turns ?? []) {
    const steps = turn.stepSnapshots ?? [];
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const step = steps[index];
      if (!step.snapshot.contextWindow) continue;
      // History is paged independently of request snapshots; only a projected
      // mutation boundary can distinguish deleted context from unloaded messages.
      if (step.snapshot.threadLastSeq < (thread?.contextBudgetInvalidatedAtSeq ?? 0)) continue;
      if (!latest || step.createdAt >= latest.createdAt) latest = step;
      break;
    }
  }
  return latest;
}

function hasCurrentCompactionBudget(thread: RuntimeThread | null): boolean {
  return thread?.contextBudgetInvalidatedAtSeq === undefined
    || (thread.contextCompaction?.seq ?? 0) > thread.contextBudgetInvalidatedAtSeq;
}

export function activeModelContextWindowTokens(
  config: RuntimeConfigState | null,
  thread: RuntimeThread | null = null,
): number | undefined {
  return positiveTokenLimit(chatThreadModelSelection(config, thread).model?.contextWindowTokens);
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
