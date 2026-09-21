import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  isRuntimeInlineMessageAttachment,
  type RuntimeConfigState,
  type RuntimeContextCompactionNotice,
  type RuntimeMessage,
  type RuntimeModelRequestContextWindow,
  type RuntimeThread,
  type RuntimeThreadTurnStepSnapshot,
} from '@setsuna-desktop/contracts';
import { chatThreadModelSelection } from '../chatModelSelection.js';

const DEFAULT_CONTEXT_TOKENS = DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
const APPROX_CHARS_PER_TOKEN = 4;

export type ChatContextTokenUsage = {
  compactedMessageCount: number;
  percent: number;
  summaryRole?: string;
  totalTokens: number;
  triggerScopes: string[];
  usedTokens: number;
  reservedOutputTokens?: number;
  visiblePercent: number;
};

type ModelContextBudget = Pick<RuntimeModelRequestContextWindow, 'maxContextTokens' | 'reservedOutputTokens'>;

export function contextTokenUsageFromThread(thread: RuntimeThread | null, configuredBudget?: ModelContextBudget): ChatContextTokenUsage {
  const notice = latestContextCompactionNotice(thread);
  const state = thread?.contextCompaction;
  const budget = runtimeContextBudget(thread, notice);
  const compactionBudgetValid = hasCurrentCompactionBudget(thread);
  const configuredLimit = positiveTokenLimit(configuredBudget?.maxContextTokens);
  const hasActiveRequest = Boolean(thread?.activeTurnId && latestContextStep(thread)?.snapshot.turnId === thread.activeTurnId);
  // An in-flight request owns its budget even if model settings change while it runs.
  const totalTokens = (hasActiveRequest ? budget?.maxContextTokens : undefined)
    ?? configuredLimit ?? budget?.maxContextTokens
    ?? notice?.maxContextTokens ?? state?.maxContextTokens ?? DEFAULT_CONTEXT_TOKENS;
  // 保留快照中的提示词、工具与重放估算，但输出预留不是已经输入模型的内容。
  const previousOutputReserve = Math.max(0, budget?.reservedOutputTokens ?? 0);
  const reservedOutputTokens = hasActiveRequest ? previousOutputReserve
    : configuredBudget?.reservedOutputTokens ?? previousOutputReserve;
  // Historical input still subtracts its own output reserve, even after selecting a new model.
  const usedTokens = budget ? Math.max(0, budget.estimatedTokens - previousOutputReserve) : positiveNumber(
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
    reservedOutputTokens,
    visiblePercent: rawPercent > 0 && rawPercent < 0.1 ? 0.1 : rawPercent,
  };
}

type ContextBudget = Pick<RuntimeModelRequestContextWindow, 'estimatedTokens' | 'maxContextTokens' | 'reservedOutputTokens'>;

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
      reservedOutputTokens: window?.reservedOutputTokens,
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
      reservedOutputTokens: window?.reservedOutputTokens,
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

export function activeModelContextBudget(
  config: RuntimeConfigState | null,
  thread: RuntimeThread | null = null,
): ModelContextBudget | undefined {
  if (!config) return undefined;
  const model = chatThreadModelSelection(config, thread).model;
  // An unset field means the current default, not the last model's recorded window.
  const maxContextTokens = positiveTokenLimit(model?.contextWindowTokens)
    ?? positiveTokenLimit(config.desktopSettings?.modelContextWindow ?? config.desktopSettings?.model_context_window)
    ?? DEFAULT_CONTEXT_TOKENS;
  return {
    maxContextTokens,
    reservedOutputTokens: Math.min(Math.max(0, Math.floor(model?.maxOutputTokens ?? 0)), Math.floor(maxContextTokens * 0.15)),
  };
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
