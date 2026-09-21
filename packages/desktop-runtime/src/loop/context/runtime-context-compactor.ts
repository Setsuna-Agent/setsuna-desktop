import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  RUNTIME_PROVIDER_METADATA_MAX_BYTES,
  runtimeJsonByteLength,
  sanitizeRuntimeJsonObject,
  type PendingRuntimeEvent,
  type ModelRequest,
  type RuntimeConfigState,
  type RuntimeEvent,
  type RuntimeMessage,
  type RuntimeMessageProviderMetadata,
  type RuntimeModelRequestStepSnapshot,
  type RuntimeThread,
  type RuntimeToolDefinition,
  type RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { RuntimeCompactionDebugPayload } from '@setsuna-desktop/feature-conversation-debug/contracts';
import { createHash } from 'node:crypto';
import type { RuntimeCompactHookTrigger } from '../../hooks/runtime-hooks.js';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ModelClient } from '../../ports/model-client.js';
import {
  appendRuntimeDebugTraceSafely,
  runtimeDebugTraceEnabled,
  type RuntimeDebugTraceSink,
} from '../../ports/runtime-debug-trace.js';
import type { UsageRecorder } from '../../ports/usage-store.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';
import { PROVIDER_METADATA_SEMANTIC_BINDING_RESERVE_BYTES } from '../../utils/runtime-message-semantic-fingerprint.js';
import {
  createRuntimeContextCompactionCandidate,
  estimateRuntimeMessageTokens,
  estimateRuntimeToolDefinitionTokens,
  materializeRuntimeContextCompaction,
  reserveRuntimeContextCompactionBudget,
  runtimeContextTokenUsageForMessages,
  type RuntimeContextCompactionBudget,
  type RuntimeContextCompactionCandidate,
} from './context-compaction.js';
import { compactForPrompt } from './prompt-utils.js';
import {
  compactionSummarySource,
  parseCompactionSummary,
  stripContextCompactionTags,
  type CompactionSummarySource,
} from './context-compaction-summary.js';
import { contextCompactionRequest, contextCompactionRequestBudget, type ContextCompactionRequestBudget } from './context-compaction-request.js';
import { nextContextCompactionBatch } from './context-compaction-batches.js';
import { nativeCompactionMatchesModel, restoreNativeCompactionHistory } from './context-compaction-history.js';

type GeneratedContextCompactionSummary = {
  source: 'local' | 'remote';
  text: string;
  providerMetadata?: RuntimeMessageProviderMetadata;
  omittedProviderMetadata?: RuntimeMessageProviderMetadata;
  nativeSourceMessageIds?: string[];
};

type NativeContextCompactionArtifact = {
  providerMetadata?: RuntimeMessageProviderMetadata;
  omittedProviderMetadata?: RuntimeMessageProviderMetadata;
};

type RuntimeContextCompactorOptions = {
  clock: Clock;
  debugTrace?: RuntimeDebugTraceSink;
  ids: IdGenerator;
  modelClient: ModelClient;
  usageStore?: UsageRecorder;
  appendEvent(
    threadId: string,
    event: PendingRuntimeEvent,
  ): Promise<RuntimeEvent | null | void>;
  onCompacted(threadId: string): void;
  runCompactHooks(input: {
    eventName: 'PreCompact' | 'PostCompact';
    runtimeConfig: RuntimeConfigState | null | undefined;
    signal?: AbortSignal;
    thread: RuntimeThread;
    trigger: RuntimeCompactHookTrigger;
    turnId: string;
  }): Promise<{ shouldStop?: boolean; stopReason?: string }>;
};

type RuntimeCompactionDebugContext = {
  afterEventSeq: number;
  spanId: string;
  threadId: string;
  turnId: string;
};

type CompactionSamplingInput = {
  candidate: RuntimeContextCompactionCandidate;
  threadId: string;
  recordUsage: (usage: RuntimeUsage) => Promise<void>;
  signal?: AbortSignal;
  debugContext?: RuntimeCompactionDebugContext;
  runtimeConfig?: RuntimeConfigState | null;
  conversationModel?: Pick<ModelRequest, 'model' | 'providerId'>;
};

/** 管理上下文窗口策略、摘要生成及压缩事件投影。 */
export class RuntimeContextCompactor {
  constructor(private readonly options: RuntimeContextCompactorOptions) {}

  async compactMessagesBeforeModelRequest({ contextBudget, conversationModel, force, messages, reservedTokens = 0, runtimeConfig, signal, thread, threadId, turnId }: { contextBudget?: RuntimeContextCompactionBudget; conversationModel?: Pick<ModelRequest, 'model' | 'providerId'>; force: boolean; messages: RuntimeMessage[]; reservedTokens?: number; runtimeConfig: RuntimeConfigState | null | undefined; signal: AbortSignal; thread: RuntimeThread; threadId: string; turnId: string }): Promise<RuntimeMessage[]> {
    messages = restoreNativeCompactionHistory(messages, (message) => Boolean(conversationModel && nativeCompactionMatchesModel(message, runtimeConfig, conversationModel)));
    // 自动压缩必须先持久化再发模型请求，保证 UI、存储历史和实际 prompt window 一致。
    const budget = reserveRuntimeContextCompactionBudget(
      contextBudget ?? contextCompactionBudgetForConfig(runtimeConfig),
      reservedTokens,
    );
    const candidate = createRuntimeContextCompactionCandidate({ budget, force, messages, activeTurnId: turnId });
    if (!candidate) return messages;
    const trigger = compactHookTrigger(force);
    const preCompact = await this.options.runCompactHooks({
      eventName: 'PreCompact',
      runtimeConfig,
      signal,
      thread,
      trigger,
      turnId,
    });
    if (preCompact.shouldStop) throw new HookStoppedTurnError(preCompact.stopReason || 'PreCompact hook stopped execution');
    const compactingEvent = await this.publishContextCompacting(
      threadId,
      turnId,
      force,
      messages,
      budget,
    );
    const debugContext = runtimeDebugTraceEnabled(this.options.debugTrace)
      ? {
          afterEventSeq: committedEventSeq(compactingEvent, thread.lastSeq),
          spanId: `context-compaction:${turnId}:${candidate.olderMessages.length}:${candidate.recentMessages.length}`,
          threadId,
          turnId,
        }
      : undefined;
    const summary = await this.generateContextCompactionSummary({
      candidate, threadId, turnId, signal, debugContext, runtimeConfig, conversationModel,
    });
    const result = materializeRuntimeContextCompaction({
      candidate,
      createdAt: this.options.clock.now().toISOString(),
      id: this.options.ids.id('msg'),
      providerMetadata: summary.providerMetadata,
      nativeSourceMessageIds: summary.nativeSourceMessageIds,
      source: summary.source,
      summary: summary.text,
      turnId,
    });
    throwIfAborted(signal);
    if ((!force && result.notice.compactedRequestTokens! >= candidate.originalTokens + candidate.reservedTokens)
      || result.notice.compactedRequestTokens! >= candidate.autoCompactTokenLimit) {
      throw new Error('Context compaction did not free enough space; original history was retained.');
    }
    const metadataWarningEvent = await this.publishProviderMetadataWarning(
      threadId,
      turnId,
      summary.omittedProviderMetadata,
    );
    advanceDebugAnchor(debugContext, metadataWarningEvent);
    const compactedEvent = await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'thread.context_compacted',
      createdAt: this.options.clock.now().toISOString(),
      payload: result,
    });
    advanceDebugAnchor(debugContext, compactedEvent);
    this.options.onCompacted(threadId);
    this.traceCompaction(debugContext, 'context.compaction.completed', {
      metadataPersisted: Boolean(summary.providerMetadata),
      olderMessageCount: candidate.olderMessages.length,
      outcome: 'success',
      recentMessageCount: candidate.recentMessages.length,
      source: summary.source,
      summaryCharacters: summary.text.length,
    });
    const postCompact = await this.options.runCompactHooks({
      eventName: 'PostCompact',
      runtimeConfig,
      signal,
      thread,
      trigger,
      turnId,
    });
    if (postCompact.shouldStop) throw new HookStoppedTurnError(postCompact.stopReason || 'PostCompact hook stopped execution');
    return result.messages;
  }

  /**
   * 调用压缩模型生成上下文摘要。
   *
   * 每次模型调用结束即记录用量，不依赖摘要校验或压缩提交是否成功。
   */
  async generateContextCompactionSummary({
    candidate, threadId, turnId, signal, debugContext, runtimeConfig, conversationModel,
  }: {
    candidate: RuntimeContextCompactionCandidate;
    threadId: string;
    turnId: string;
    signal?: AbortSignal;
    debugContext?: RuntimeCompactionDebugContext;
    runtimeConfig?: RuntimeConfigState | null;
    conversationModel?: Pick<ModelRequest, 'model' | 'providerId'>;
  }): Promise<GeneratedContextCompactionSummary> {
    const recordUsage = async (usage: RuntimeUsage): Promise<void> => {
      const event = await this.publishContextCompactionUsage(threadId, turnId, usage);
      advanceDebugAnchor(debugContext, event);
    };
    const samplingInput = { candidate, threadId, recordUsage, signal, debugContext, runtimeConfig, conversationModel };
    const provider = runtimeConfig?.providers.find((item) => item.id === (conversationModel?.providerId ?? runtimeConfig.activeProviderId));
    // An explicit task model selects portable compaction. Native-only checkpoints require all
    // source messages to survive transcript archival, including on a later provider switch.
    const useNative = !runtimeConfig?.taskModels?.contextCompaction
      && (!provider || provider.provider === 'openai-responses')
      && !candidate.olderMessages.some((message) => message.visibility === 'model');
    const nativeArtifact: NativeContextCompactionArtifact = useNative ? await this.generateNativeContextCompaction(samplingInput) : {};
    if (nativeArtifact.providerMetadata) {
      const nativeTokens = Math.ceil(runtimeJsonByteLength(sanitizeRuntimeJsonObject(nativeArtifact.providerMetadata) ?? {}) / 4) + 256;
      const available = candidate.autoCompactTokenLimit - candidate.reservedTokens
        - estimateRuntimeMessageTokens([...candidate.pinnedMessages, ...candidate.recentMessages]);
      if (nativeTokens < available) {
        return {
          source: 'remote',
          text: 'Earlier context is preserved in provider-native compaction state.',
          providerMetadata: nativeArtifact.providerMetadata,
          nativeSourceMessageIds: candidate.olderMessages.filter((message) => message.visibility !== 'transcript').map((message) => message.id),
        };
      }
      nativeArtifact.omittedProviderMetadata = nativeArtifact.providerMetadata;
    }
    const portableSummary = await this.generatePortableContextCompactionSummary({
      ...samplingInput,
      candidate: { ...candidate, olderMessages: restoreNativeCompactionHistory(candidate.olderMessages) },
    });
    return {
      source: 'local',
      text: portableSummary,
      ...(nativeArtifact.omittedProviderMetadata
        ? { omittedProviderMetadata: nativeArtifact.omittedProviderMetadata }
        : {}),
    };
  }

  private async generatePortableContextCompactionSummary(input: CompactionSamplingInput): Promise<string> {
    const budget = contextCompactionRequestBudget(input);
    let source = compactionSummarySource(input.candidate);
    let summary = '';
    do {
      throwIfAborted(input.signal);
      const batch = nextContextCompactionBatch({
        source, previousSummary: summary, budget, createdAt: this.options.clock.now().toISOString(),
      });
      summary = await this.generatePortableContextCompactionBatch({
        ...input, budget, source: batch.source, previousSummary: summary,
      });
      source = batch.remaining;
    } while (source.olderHistory || source.recentContext);
    return summary;
  }

  private async generatePortableContextCompactionBatch({
    candidate, threadId, recordUsage, signal, debugContext, budget, source, previousSummary,
  }: CompactionSamplingInput & { budget: ContextCompactionRequestBudget; source: CompactionSummarySource; previousSummary: string }): Promise<string> {
    this.traceCompaction(debugContext, 'context.compaction.portable', {
      olderMessageCount: candidate.olderMessages.length,
      outcome: 'started',
      recentMessageCount: candidate.recentMessages.length,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      throwIfAborted(signal);
      const output = createModelStreamTextCollector();
      const request = contextCompactionRequest({
        budget, source, previousSummary,
        createdAt: this.options.clock.now().toISOString(), retry: attempt > 0,
      });
      let usage: RuntimeUsage | undefined;
      let completed = false;
      let finishReason: string | undefined;
      try {
        for await (const item of this.options.modelClient.stream({
          ...request,
          sessionId: threadId,
          signal,
        })) {
          if (item.type === 'usage' || item.type === 'token_count') usage = item.usage;
          throwIfAborted(signal);
          output.consume(item);
          if (item.type === 'done') { completed = true; finishReason = item.finishReason; }
        }
        throwIfAborted(signal);
        if (!completed || (finishReason !== undefined && finishReason !== 'stop')) {
          throw new Error(`Context compaction response was incomplete (${finishReason ?? 'stream closed'}; generation limit ${request.maxOutputTokens} tokens${output.text().trim() ? '' : '; no summary text'}).`);
        }
        const text = parseCompactionSummary(output.text(), budget.summaryTokenLimit);
        this.traceCompaction(debugContext, 'context.compaction.portable', {
          olderMessageCount: candidate.olderMessages.length, outcome: 'success',
          recentMessageCount: candidate.recentMessages.length, summaryCharacters: text.length,
        });
        return text;
      } catch (error) {
        this.traceCompaction(debugContext, 'context.compaction.portable', {
          error: compactionDebugError(error), olderMessageCount: candidate.olderMessages.length,
          outcome: 'error', recentMessageCount: candidate.recentMessages.length,
        });
        if (signal?.aborted) throw error;
        if (attempt === 1) throw new Error(`Context compaction failed; original history was retained. ${compactionDebugError(error)}`, { cause: error });
      } finally {
        // Usage belongs to the model call, including incomplete and cancelled attempts.
        if (usage) await recordUsage(usage);
      }
    }
    throw new Error('Context compaction failed.');
  }

  /**
   * 原生结果只在原供应商边界回放；跨模型交接从归档原文重新生成，不猜测 opaque 内容。
   */
  private async generateNativeContextCompaction({
    candidate, threadId, recordUsage, signal, debugContext, conversationModel,
  }: CompactionSamplingInput): Promise<NativeContextCompactionArtifact> {
    if (!this.options.modelClient.compactConversation) {
      this.traceCompaction(debugContext, 'context.compaction.native', {
        olderMessageCount: candidate.olderMessages.length,
        outcome: 'unsupported',
        recentMessageCount: candidate.recentMessages.length,
      });
      return {};
    }
    this.traceCompaction(debugContext, 'context.compaction.native', {
      olderMessageCount: candidate.olderMessages.length,
      outcome: 'started',
      recentMessageCount: candidate.recentMessages.length,
    });
    let usage: RuntimeUsage | undefined;
    try {
      const result = await this.options.modelClient.compactConversation({
        // Provider-native compaction stays on the current conversation model because
        // its opaque metadata is only replayable by that provider/model pair.
        ...(conversationModel ?? { model: 'context-compaction' }),
        sessionId: threadId,
        // Native compact must see the real model window, including exact provider envelopes.
        messages: candidate.olderMessages,
        signal,
      });
      usage = result.usage;
      throwIfAborted(signal);
      if (result.kind !== 'native') {
        this.traceCompaction(debugContext, 'context.compaction.native', {
          olderMessageCount: candidate.olderMessages.length,
          outcome: 'fallback',
          recentMessageCount: candidate.recentMessages.length,
        });
        return {};
      }
      const metadataFits = providerMetadataFitsPersistenceLimit(result.providerMetadata);
      this.traceCompaction(debugContext, 'context.compaction.native', {
        metadataPersisted: metadataFits,
        olderMessageCount: candidate.olderMessages.length,
        outcome: 'success',
        recentMessageCount: candidate.recentMessages.length,
      });
      return {
        ...(metadataFits ? { providerMetadata: result.providerMetadata } : {}),
        ...(!metadataFits ? { omittedProviderMetadata: result.providerMetadata } : {}),
      };
    } catch (error) {
      this.traceCompaction(debugContext, 'context.compaction.native', {
        error: compactionDebugError(error),
        olderMessageCount: candidate.olderMessages.length,
        outcome: 'error',
        recentMessageCount: candidate.recentMessages.length,
      });
      if (signal?.aborted) throw error;
      return {};
    } finally {
      if (usage) await recordUsage(usage);
    }
  }

  private traceCompaction(
    context: RuntimeCompactionDebugContext | undefined,
    kind:
      | 'context.compaction.completed'
      | 'context.compaction.native'
      | 'context.compaction.portable',
    payload: RuntimeCompactionDebugPayload,
  ): void {
    if (!context) return;
    appendRuntimeDebugTraceSafely(this.options.debugTrace, {
      afterEventSeq: context.afterEventSeq,
      kind,
      payload,
      spanId: context.spanId,
      threadId: context.threadId,
      turnId: context.turnId,
    });
  }

  private async publishContextCompactionUsage(
    threadId: string,
    turnId: string,
    usage: RuntimeUsage,
  ): Promise<RuntimeEvent | null | void> {
    const createdAt = this.options.clock.now().toISOString();
    const event = await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'token.count',
      createdAt,
      payload: { usage },
    });
    await this.options.usageStore?.recordUsage({
      threadId,
      turnId,
      createdAt,
      ...usage,
    });
    return event;
  }

  async publishProviderMetadataWarning(
    threadId: string,
    turnId: string,
    omittedMetadata: RuntimeMessageProviderMetadata | undefined,
  ): Promise<RuntimeEvent | null | void> {
    if (!omittedMetadata) return;
    return this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'model.verification',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        verification: {
          model: omittedMetadata.source?.model,
          provider: omittedMetadata.source?.providerKind,
          warnings: ['provider_metadata_omitted_too_large'],
        },
      },
    });
  }

  /**
   * 发布 thread.context_compacting 事件，通知 UI 当前压缩进度和 token 使用。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 触发压缩的 turn ID，手动压缩也会生成临时 turn。
   * @param force 是否为手动强制压缩。
   * @param messages 用于估算 token 使用量的消息列表。
   */
  async publishContextCompacting(
    threadId: string,
    turnId: string | undefined,
    force: boolean,
    messages: RuntimeMessage[],
    budget?: RuntimeContextCompactionBudget,
  ): Promise<RuntimeEvent | null | void> {
    const usage = runtimeContextTokenUsageForMessages(messages, budget);
    return this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'thread.context_compacting',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        forced: force || undefined,
        maxContextTokens: usage.maxContextTokens,
        maxContextTokensK: usage.maxContextTokensK,
        percent: usage.percent,
        usedTokens: usage.usedTokens,
      },
    });
  }

}

function committedEventSeq(
  event: RuntimeEvent | null | void,
  fallback: number,
): number {
  return event?.seq ?? fallback;
}

function advanceDebugAnchor(
  context: RuntimeCompactionDebugContext | undefined,
  event: RuntimeEvent | null | void,
): void {
  if (!context || !event) return;
  context.afterEventSeq = Math.max(context.afterEventSeq, event.seq);
}

export class HookStoppedTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HookStoppedTurnError';
  }
}

export function compactHookTrigger(force: boolean): RuntimeCompactHookTrigger {
  return force ? 'manual' : 'auto';
}

export function contextCompactionBudgetForConfig(
  config: RuntimeConfigState | null | undefined,
  modelOverride?: RuntimeConfigState['providers'][number]['models'][number],
): RuntimeContextCompactionBudget | undefined {
  if (!config) return undefined;
  const activeProvider = config.providers.find((provider) => provider.id === config.activeProviderId && provider.enabled)
    ?? config.providers.find((provider) => provider.enabled)
    ?? config.providers[0];
  const activeModel = modelOverride
    ?? activeProvider?.models.find((model) => model.enabled)
    ?? activeProvider?.models[0];
  const maxContextTokens = positiveRuntimeInt(
    activeModel?.contextWindowTokens ??
    config.desktopSettings?.modelContextWindow ??
    config.desktopSettings?.model_context_window,
  );
  const autoCompactTokenLimit = positiveRuntimeInt(
    config.desktopSettings?.modelAutoCompactTokenLimit ??
    config.desktopSettings?.model_auto_compact_token_limit,
  );
  if (maxContextTokens === undefined && autoCompactTokenLimit === undefined) return undefined;
  return {
    ...(maxContextTokens !== undefined ? { maxContextTokens } : {}),
    ...(autoCompactTokenLimit !== undefined ? { autoCompactTokenLimit } : {}),
  };
}

/** Reserve the continuation's output separately from the summarizer's generation budget. */
export function reservedOutputTokensForConfig(
  config: RuntimeConfigState | null | undefined,
  modelOverride?: RuntimeConfigState['providers'][number]['models'][number],
): number {
  const provider = config?.providers.find((item) => item.enabled && item.id === config.activeProviderId)
    ?? config?.providers.find((item) => item.enabled);
  const model = modelOverride ?? provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  const contextWindow = contextCompactionBudgetForConfig(config, model)?.maxContextTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
  return Math.min(Math.max(0, Math.floor(model?.maxOutputTokens ?? 0)), Math.floor(contextWindow * 0.15));
}

function positiveRuntimeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function samplingContextWindowForRequest({
  budget,
  messages,
  reservedOutputTokens = 0,
  tools = [],
}: {
  budget?: RuntimeContextCompactionBudget;
  messages: RuntimeMessage[];
  reservedOutputTokens?: number;
  tools?: RuntimeToolDefinition[];
}): RuntimeModelRequestStepSnapshot['contextWindow'] {
  const usage = runtimeContextTokenUsageForMessages(messages, budget);
  const toolDefinitionTokens = estimateRuntimeToolDefinitionTokens(tools);
  const normalizedOutputReserve = Math.max(0, Math.floor(reservedOutputTokens));
  const estimatedTokens = usage.usedTokens + toolDefinitionTokens + normalizedOutputReserve;
  const compactionSummaryMessageIds = messages
    .filter((message) => message.contextCompaction)
    .map((message) => message.id);
  return {
    autoCompactTokenLimit: usage.autoCompactTokenLimit,
    ...(compactionSummaryMessageIds.length ? { compactionHash: contextCompactionHash(messages) } : {}),
    compactionSummaryMessageIds,
    estimatedTokens,
    messageTokens: usage.usedTokens,
    toolDefinitionTokens,
    reservedOutputTokens: normalizedOutputReserve,
    maxContextTokens: usage.maxContextTokens,
    maxContextTokensK: usage.maxContextTokensK,
    messageCount: messages.length,
    tokensUntilCompaction: Math.max(0, usage.autoCompactTokenLimit - estimatedTokens),
  };
}

export function samplingInputMessageIds(messages: RuntimeMessage[], turnId: string): string[] {
  return messages
    .filter((message) => message.turnId === turnId && ((message.role === 'user' && !message.contextCompaction) || message.id.startsWith('mailbox_')))
    .map((message) => message.id);
}

function contextCompactionHash(messages: RuntimeMessage[]): string {
  const summaries = messages
    .filter((message) => message.contextCompaction)
    .map((message) => ({
      content: stripContextCompactionTags(message.content),
      id: message.id,
      notice: message.contextCompaction,
    }));
  return `sha256:${createHash('sha256').update(JSON.stringify(summaries)).digest('hex')}`;
}

function providerMetadataFitsPersistenceLimit(
  metadata: RuntimeMessageProviderMetadata,
): boolean {
  const json = sanitizeRuntimeJsonObject(metadata);
  return Boolean(
    json
    && runtimeJsonByteLength(json)
      <= RUNTIME_PROVIDER_METADATA_MAX_BYTES - PROVIDER_METADATA_SEMANTIC_BINDING_RESERVE_BYTES,
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'Turn cancelled.');
  error.name = 'AbortError';
  throw error;
}

function compactionDebugError(error: unknown): string {
  const name = error instanceof Error ? error.name || 'Error' : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  const redacted = message
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[a-z0-9_-]+\b/giu, '[redacted api key]')
    .replace(/([?&](?:api[_-]?key|token)=)[^&\s]+/giu, '$1[redacted]');
  return `${name}: ${compactForPrompt(redacted, 240)}`;
}
