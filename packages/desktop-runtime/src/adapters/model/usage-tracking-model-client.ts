import type {
  ModelCompactionRequest,
  ModelRequest,
  ModelStreamEvent,
  RuntimeUsage,
  RuntimeUsageRecord,
  RuntimeUsageResult,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { UsageRecorder } from '../../ports/usage-store.js';

type UsageTrackingOptions = {
  clock: Clock;
  recorder: UsageRecorder;
  monotonicNow?: () => number;
  onRecorded?(record: RuntimeUsageRecord): Promise<void>;
  onRecordingError?(error: unknown): void;
};

/** One ledger entry per model invocation, independently of the caller's parsing or turn outcome. */
export class UsageTrackingModelClient implements ModelClient {
  readonly compactConversation?: ModelClient['compactConversation'];
  private readonly now: () => number;

  constructor(private readonly inner: ModelClient, private readonly options: UsageTrackingOptions) {
    this.now = options.monotonicNow ?? (() => performance.now());
    if (inner.compactConversation) {
      this.compactConversation = async (request) => {
        const { usageContext: _context, ...providerRequest } = request;
        const started = this.now();
        const createdAt = options.clock.now().toISOString();
        let usage: RuntimeUsage | undefined;
        let result: RuntimeUsageResult = 'error';
        try {
          const response = await inner.compactConversation!({
            ...providerRequest,
            onUsage: (observed) => { usage = observed; request.onUsage?.(observed); },
          });
          usage = response.usage ?? usage;
          result = 'success';
          return response;
        } catch (error) {
          if (isAbortError(error)) result = 'cancelled';
          throw error;
        } finally {
          await this.record(request, createdAt, started, result, usage);
        }
      };
    }
  }

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    // Strip local attribution before crossing the provider boundary.
    const { usageContext: _context, ...providerRequest } = request;
    const started = this.now();
    const createdAt = this.options.clock.now().toISOString();
    let usage: RuntimeUsage | undefined;
    let protocolUsage: RuntimeUsage | undefined;
    let result: RuntimeUsageResult = 'error';
    try {
      for await (const event of this.inner.stream(providerRequest)) {
        if (event.type === 'usage') usage = event.usage;
        if (event.type === 'token_count') protocolUsage = event.usage;
        yield event;
      }
      result = 'success';
    } catch (error) {
      if (isAbortError(error)) result = 'cancelled';
      throw error;
    } finally {
      // A consumer can close the iterator early (for example when cancelled). It is not a success.
      await this.record(request, createdAt, started, result, usage ?? protocolUsage);
    }
  }

  private async record(
    request: ModelRequest | ModelCompactionRequest,
    createdAt: string,
    started: number,
    result: RuntimeUsageResult,
    usage?: RuntimeUsage,
  ): Promise<void> {
    if (!request.usageContext) return;
    const durationMs = Math.max(0, this.now() - started);
    try {
      const recorded = await this.options.recorder.recordUsage({
        providerId: request.providerId,
        model: request.model,
        ...usage,
        ...request.usageContext,
        createdAt,
        requestCount: 1,
        result: request.signal?.aborted
          ? (request.signal.reason instanceof Error && request.signal.reason.name === 'TimeoutError' ? 'error' : 'cancelled')
          : result,
        durationMs,
      });
      if (recorded.id) await this.options.onRecorded?.(recorded);
    } catch (error) {
      // Optional telemetry must never replace a model response, its error, or cancellation.
      this.options.onRecordingError?.(error);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
