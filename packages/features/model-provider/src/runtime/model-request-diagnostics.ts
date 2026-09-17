import { randomUUID } from 'node:crypto';
import type { ModelDiagnostic, ModelDiagnosticReporter, ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';

/** Observe transport boundaries without reading, parsing or retaining provider content. */
export class ModelRequestDiagnostics {
  private readonly started = performance.now();
  private readonly requestId = randomUUID();
  private readonly seen = new Set<string>();
  private readonly itemKinds = new Map<string, string>();
  private attempt = 0;

  constructor(private readonly request: ModelRequest, private readonly report?: ModelDiagnosticReporter) {}

  record(phase: string, fields: Partial<ModelDiagnostic> = {}): void {
    try {
      this.report?.({
        phase, requestId: this.requestId,
        threadId: this.request.stepSnapshot?.threadId ?? this.request.sessionId,
        turnId: this.request.stepSnapshot?.turnId,
        stepSeq: this.request.stepSnapshot?.threadLastSeq,
        providerId: this.request.providerId, model: this.request.model,
        elapsedMs: Math.round(performance.now() - this.started),
        ...fields,
      });
    } catch { /* Logging must not change request behavior. */ }
  }

  observe(event: ModelStreamEvent): void {
    if (!this.seen.has('event')) {
      this.seen.add('event');
      this.record('model.first_event');
    }
    if (event.type === 'item_started') this.itemKinds.set(event.item.id, event.item.kind);
    // Empty SDK item starts are not visible output (notably legacy <think> streams).
    const kind = event.type === 'item_delta' && event.delta ? this.itemKinds.get(event.itemId)
      : event.type === 'text_delta' && event.text ? 'agent_message'
        : event.type === 'tool_call_delta' ? 'tool_call' : undefined;
    if (event.type === 'item_completed') this.itemKinds.delete(event.item.id);
    if (kind && !this.seen.has(kind)) {
      this.seen.add(kind);
      this.record(`model.first_${kind}`);
    }
    if (event.type === 'usage') {
      const { inputTokens, cachedInputTokens, outputTokens } = event.usage;
      this.record('model.usage', { inputTokens, cachedInputTokens, outputTokens });
    }
    if (event.type === 'model_verification') this.record('model.verification');
  }

  wrapFetch(fetchImpl: typeof fetch): typeof fetch {
    if (!this.report) return fetchImpl;
    return async (input, init) => {
      const attempt = ++this.attempt;
      const started = performance.now();
      const record = (phase: string, fields: Partial<ModelDiagnostic> = {}) => this.record(phase, {
        attempt, elapsedMs: Math.round(performance.now() - started), ...fields,
      });
      const body = init?.body;
      record('http.started', { requestBytes: typeof body === 'string' ? Buffer.byteLength(body) : undefined });
      let response: Response;
      try {
        response = await fetchImpl(input, init);
      } catch (error) {
        record('http.failed', { aborted: init?.signal?.aborted ?? false });
        throw error;
      }
      record('http.headers', { status: response.status });
      if (!response.body) return response;
      const reader = response.body.getReader();
      let responseBytes = 0;
      let first = true;
      let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (closed) return;
            if (result.done) {
              closed = true;
              record('http.completed', { responseBytes });
              reader.releaseLock();
              controller.close();
              return;
            }
            responseBytes += result.value.byteLength;
            if (first) {
              first = false;
              record('http.first_chunk', { responseBytes });
            }
            controller.enqueue(result.value);
          } catch (error) {
            if (closed) return;
            closed = true;
            record('http.stream_failed', { responseBytes, aborted: init?.signal?.aborted ?? false });
            reader.releaseLock();
            controller.error(error);
          }
        },
        async cancel(reason) {
          closed = true;
          record('http.cancelled', { responseBytes });
          try { await reader.cancel(reason); } finally { reader.releaseLock(); }
        },
      });
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
  }
}
