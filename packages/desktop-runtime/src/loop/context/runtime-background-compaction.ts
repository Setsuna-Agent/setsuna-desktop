import { MODEL_REQUEST_TOTAL_TIMEOUT_MS, type RuntimeMessage, type StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { ConfigStore } from '../../ports/config-store.js';
import type { EventBus } from '../../ports/event-bus.js';
import type { ContextWindowSnapshot } from '../../ports/thread-store.js';
import { captureContextWindow, contextWindowMatches } from '../../utils/context-window-snapshot.js';
import { compactionConfigurationKey } from './compaction-configuration.js';
import { reserveRuntimeContextCompactionBudget, runtimeContextTokenUsageForMessages } from './context-compaction.js';
import { contextCompactionBudgetForConfig, type PreparedContextCompaction, type RuntimeContextCompactionInput, type RuntimeContextCompactor } from './runtime-context-compactor.js';

export const BACKGROUND_COMPACTION_FEATURE = 'backgroundContextCompaction';
const SOFT_LIMIT_RATIO = 0.8;
const MAX_RUNNING = 2;
const MAX_RETAINED = 32;

type Job = {
  controller: AbortController;
  signal: AbortSignal;
  source: ContextWindowSnapshot;
  key?: string;
  done: Promise<void>;
  pending: boolean;
  prepared?: PreparedContextCompaction;
  installing?: boolean;
  startedAt: number;
  requestIdentity: string;
  turnId: string;
};

/** One candidate per thread; generation never mutates history or delays a completed answer. */
export class RuntimeBackgroundCompaction {
  private readonly jobs = new Map<string, Job>();
  private readonly running = new Set<Job>();
  private readonly failed = new Map<string, string>();
  private readonly unsubscribe: Array<() => void> = [];
  private closed = false;

  constructor(private readonly options: {
    compactor: Pick<RuntimeContextCompactor, 'prepare' | 'install' | 'compactMessagesBeforeModelRequest'>;
    configStore?: ConfigStore;
    eventBus?: EventBus;
  }) {
    const configSubscription = options.configStore?.subscribe?.(() => this.cancelAll());
    if (configSubscription) this.unsubscribe.push(configSubscription);
    if (options.eventBus) this.unsubscribe.push(options.eventBus.subscribeAll((event) => this.observe(event)));
  }

  pendingCount(): number { return this.running.size; }

  /** Goal accounting must observe all usage owned by its turn before advancing its watermark. */
  settleTurn(threadId: string, turnId: string): Promise<void> {
    const job = this.jobs.get(threadId);
    return job?.turnId === turnId ? job.done : Promise.resolve();
  }

  async beforeRequest(input: RuntimeContextCompactionInput): Promise<RuntimeMessage[]> {
    const enabled = input.runtimeConfig?.features?.[BACKGROUND_COMPACTION_FEATURE] === true;
    if (!enabled || input.force) this.cancel(input.threadId);
    const job = this.jobs.get(input.threadId);
    const usage = usageFor(input);
    if (enabled && !input.force && job && !job.signal.aborted) {
      const source = input.sourceSnapshot?.messages ?? input.messages;
      if (job.requestIdentity !== requestIdentity(input) || !contextWindowMatches(source, job.source)) this.cancel(input.threadId);
      else if (!job.pending || usage.usedTokens >= usage.autoCompactTokenLimit) {
        // Only the hard boundary waits. A normal response never waits for speculative work.
        const abort = () => this.cancel(input.threadId);
        input.signal.addEventListener('abort', abort, { once: true });
        try {
          await waitForJob(job, AbortSignal.any([input.signal, job.signal]));
          input.signal.throwIfAborted();
          // Validation is speculative too; a failed config read must not fail the current answer.
          const key = job.prepared && !job.signal.aborted
            ? await compactionConfigurationKey(input, this.options.configStore).catch(() => undefined) : undefined;
          if (job.prepared && !job.signal.aborted
            && key !== undefined && job.key === key) {
            job.installing = true;
            const installed = await this.options.compactor.install(job.prepared, {
              ...input, signal: AbortSignal.any([input.signal, job.signal]),
            });
            if (installed) return installed;
          }
        } catch (error) {
          if (input.signal.aborted || !job.signal.aborted) throw error;
        } finally {
          input.signal.removeEventListener('abort', abort);
          this.cancel(input.threadId);
        }
      }
    }
    return this.options.compactor.compactMessagesBeforeModelRequest(input);
  }

  start(input: RuntimeContextCompactionInput, refresh?: (signal: AbortSignal) => Promise<RuntimeContextCompactionInput>): void {
    if (this.closed || input.signal.aborted || input.runtimeConfig?.features?.[BACKGROUND_COMPACTION_FEATURE] !== true) return;
    this.prune();
    if (this.jobs.has(input.threadId) || this.running.size >= MAX_RUNNING || this.jobs.size >= MAX_RETAINED) return;
    const usage = usageFor(input);
    if (usage.usedTokens < usage.autoCompactTokenLimit * SOFT_LIMIT_RATIO) return;
    const source = captureSource(input);
    const retryKey = JSON.stringify([source.fingerprint, input.requestContextKey, input.conversationModel]);
    if (this.failed.get(input.threadId) === retryKey) return;
    const controller = new AbortController();
    const job: Job = {
      controller, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MODEL_REQUEST_TOTAL_TIMEOUT_MS)]),
      source, pending: true, startedAt: Date.now(), done: Promise.resolve(), requestIdentity: requestIdentity(input), turnId: input.turnId,
    };
    this.jobs.set(input.threadId, job);
    this.running.add(job);
    job.done = Promise.resolve().then(async () => {
      const snapshot = refresh ? await refresh(job.signal) : input;
      job.signal.throwIfAborted();
      job.source = captureSource(snapshot);
      job.key = await compactionConfigurationKey(snapshot, this.options.configStore);
      job.signal.throwIfAborted();
      job.prepared = await this.options.compactor.prepare({ ...snapshot, force: false, signal: job.signal }, true) ?? undefined;
      if (job.signal.aborted) job.prepared = undefined;
      if (!job.prepared && !job.signal.aborted) this.rememberFailure(input.threadId, retryKey);
    }).catch(() => {
      // Actual model usage is recorded by the shared compactor even when the candidate is discarded.
      if (!job.signal.aborted) this.rememberFailure(input.threadId, retryKey);
    }).finally(() => {
      job.pending = false;
      this.running.delete(job);
      if (!job.prepared || job.signal.aborted) {
        job.prepared = undefined;
        if (this.jobs.get(input.threadId) === job) this.jobs.delete(input.threadId);
      }
    });
  }

  cancel(threadId: string): Promise<void> {
    const job = this.jobs.get(threadId);
    if (!job) return Promise.resolve();
    job.controller.abort();
    job.prepared = undefined;
    // Keep an aborted in-flight slot until it settles: an uncooperative provider cannot overlap a replacement.
    if (!job.pending) this.jobs.delete(threadId);
    return job.done;
  }

  cancelAll(): void {
    for (const threadId of this.jobs.keys()) void this.cancel(threadId);
    this.failed.clear();
  }

  async shutdown(timeoutMs: number): Promise<boolean> {
    this.closed = true;
    this.unsubscribe.splice(0).forEach((unsubscribe) => unsubscribe());
    this.cancelAll();
    if (!this.running.size) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.all([...this.running].map((job) => job.done)).then(() => true),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); timer.unref(); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private observe(event: StoredThreadEvent): void {
    const job = this.jobs.get(event.threadId);
    if (!job) return;
    if (event.type === 'thread.context_compacted' && job.installing && event.id === job.prepared?.event.id) return;
    if (event.type === 'thread.context_cleared' || event.type === 'thread.context_compacted'
      || event.type === 'messages.deleted' || event.type === 'messages.truncated' || event.type === 'thread.deleted'
      || event.type === 'turn.cancelled' || event.type === 'runtime.error'
      || (event.type === 'thread.updated' && (event.payload.modelBinding || event.payload.projectId !== undefined || event.payload.workspaceId !== undefined || event.payload.archived))
      || ((event.type === 'message.updated' || event.type === 'message.completed' || event.type === 'message.delta')
        && job.source.messageIds.includes(event.payload.messageId))) void this.cancel(event.threadId);
  }

  private rememberFailure(threadId: string, key: string): void {
    this.failed.set(threadId, key);
    if (this.failed.size > MAX_RETAINED) this.failed.delete(this.failed.keys().next().value!);
  }

  private prune(): void {
    for (const [threadId, job] of this.jobs) {
      if (job.signal.aborted || Date.now() - job.startedAt >= MODEL_REQUEST_TOTAL_TIMEOUT_MS) void this.cancel(threadId);
    }
  }
}

function captureSource(input: RuntimeContextCompactionInput): ContextWindowSnapshot {
  return captureContextWindow(input.sourceSnapshot?.messages ?? input.messages,
    input.sourceSnapshot ? new Set(input.sourceSnapshot.sourceMessageIds) : undefined);
}

function requestIdentity(input: RuntimeContextCompactionInput): string {
  return JSON.stringify([input.conversationModel, input.requestContextKey]);
}

function usageFor(input: RuntimeContextCompactionInput) {
  return runtimeContextTokenUsageForMessages(input.messages,
    reserveRuntimeContextCompactionBudget(input.contextBudget ?? contextCompactionBudgetForConfig(input.runtimeConfig), input.reservedTokens ?? 0));
}

async function waitForJob(job: Job, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    await Promise.race([job.done, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
