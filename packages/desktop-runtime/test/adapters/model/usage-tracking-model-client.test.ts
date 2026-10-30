import type { ModelRequest, ModelStreamEvent, RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { UsageTrackingModelClient } from '../../../src/adapters/model/usage-tracking-model-client.js';
import type { ModelClient } from '../../../src/ports/model-client.js';

const request: ModelRequest = {
  model: 'selected-model', providerId: 'provider_1', messages: [],
  usageContext: { threadId: 'thread_1', turnId: 'turn_1', source: 'conversation' },
};
const clock = { now: () => new Date('2026-10-21T00:00:00.000Z') };

describe('UsageTrackingModelClient', () => {
  it('records one request from mirrored usage events with monotonic timing and local-only attribution', async () => {
    let now = 0;
    const requests: ModelRequest[] = [];
    const fixture = tracked({ async *stream(input) {
      requests.push(input);
      now = 200;
      yield { type: 'text_delta', text: 'answer' };
      now = 1200;
      yield { type: 'token_count', usage: { totalTokens: 15 } };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, model: 'actual-model' } };
      yield { type: 'done' };
    } }, () => now);

    await consume(fixture.client.stream(request));

    expect(requests[0]).not.toHaveProperty('usageContext');
    expect(fixture.records).toEqual([expect.objectContaining({
      ...request.usageContext, providerId: 'provider_1', model: 'actual-model', requestCount: 1,
      result: 'success', durationMs: 1200, totalTokens: 15,
    })]);
  });

  it.each([false, true])('preserves failed responses and only records reported tokens (usage=%s)', async (reported) => {
    const error = new Error('Upstream body contains a secret that must not enter the ledger');
    const fixture = tracked({ async *stream() {
      if (reported) yield { type: 'usage', usage: { outputTokens: 2, totalTokens: 4 } };
      throw error;
    } });
    await expect(consume(fixture.client.stream(request))).rejects.toBe(error);
    expect(fixture.records).toHaveLength(1);
    expect(fixture.records[0]).toMatchObject({ result: 'error', requestCount: 1 });
    expect(fixture.records[0]?.totalTokens).toBe(reported ? 4 : undefined);
    expect(JSON.stringify(fixture.records)).not.toContain('secret');
  });

  it.each(['AbortError', 'TimeoutError'])('distinguishes cancellation from timeouts (%s)', async (name) => {
    const controller = new AbortController();
    const error = new DOMException('stopped', name);
    const fixture = tracked({ async *stream() {
      yield { type: 'text_delta', text: 'partial' };
      controller.abort(error);
      throw error;
    } });
    await expect(consume(fixture.client.stream({ ...request, signal: controller.signal }))).rejects.toBe(error);
    expect(fixture.records[0]?.result).toBe(name === 'AbortError' ? 'cancelled' : 'error');
  });

  it('does not mark an early-closed stream as successful or record it twice', async () => {
    const controller = new AbortController();
    const fixture = tracked({ async *stream() {
      yield { type: 'text_delta', text: 'partial' };
      yield { type: 'done' };
    } });
    const stream = fixture.client.stream({ ...request, signal: controller.signal });
    await stream.next();
    controller.abort();
    await stream.return(undefined);
    await stream.return(undefined);
    expect(fixture.records).toHaveLength(1);
    expect(fixture.records[0]?.result).toBe('cancelled');
  });

  it('notifies only after a committed write and leaves responses intact if persistence fails', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const onRecorded = vi.fn();
    const recordUsage = vi.fn(async (input: Omit<RuntimeUsageRecord, 'id'>) => {
      await pending;
      return { id: 'usage_1', ...input };
    });
    const inner: ModelClient = { async *stream() { yield { type: 'text_delta', text: 'answer' }; } };
    const client = new UsageTrackingModelClient(inner, { clock, recorder: { recordUsage }, onRecorded });
    const response = consume(client.stream(request));
    await vi.waitFor(() => expect(recordUsage).toHaveBeenCalledOnce());
    expect(onRecorded).not.toHaveBeenCalled();
    finish();
    await response;
    expect(onRecorded).toHaveBeenCalledOnce();

    onRecorded.mockClear();
    recordUsage.mockRejectedValueOnce(new Error('Disk full'));
    await expect(consume(client.stream(request))).resolves.toEqual([{ type: 'text_delta', text: 'answer' }]);
    expect(onRecorded).not.toHaveBeenCalled();
    recordUsage.mockImplementationOnce(async (input) => ({ id: '', ...input }));
    await consume(client.stream(request));
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('keeps concurrent request attribution separate and leaves unattributed probes out of the ledger', async () => {
    const fixture = tracked({ async *stream(input) {
      yield { type: 'usage', usage: { totalTokens: input.model === 'second' ? 2 : 1 } };
    } });
    await Promise.all([
      consume(fixture.client.stream(request)),
      consume(fixture.client.stream({ ...request, model: 'second', usageContext: { threadId: 'thread_2', turnId: 'turn_2', source: 'title' } })),
      consume(fixture.client.stream({ model: 'probe', messages: [] })),
    ]);
    expect(fixture.records).toHaveLength(2);
    expect(fixture.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ threadId: 'thread_1', source: 'conversation', totalTokens: 1 }),
      expect.objectContaining({ threadId: 'thread_2', source: 'title', totalTokens: 2 }),
    ]));
  });

  it('records native compaction through the same ledger boundary', async () => {
    const compactConversation = vi.fn<NonNullable<ModelClient['compactConversation']>>(async () => ({ kind: 'summary' as const, summary: 'summary', usage: { totalTokens: 7 } }));
    const fixture = tracked({ async *stream() { yield { type: 'done' }; }, compactConversation });
    await fixture.client.compactConversation?.({ ...request, usageContext: { ...request.usageContext!, source: 'compaction' } });
    expect(fixture.records[0]).toMatchObject({ source: 'compaction', result: 'success', totalTokens: 7 });
    expect(compactConversation.mock.calls[0]?.[0]).not.toHaveProperty('usageContext');
  });

  it('records observed native usage once when the resulting checkpoint is rejected', async () => {
    const fixture = tracked({
      async *stream() { yield { type: 'done' }; },
      async compactConversation(input) {
        input.onUsage?.({ inputTokens: 120, outputTokens: 30, totalTokens: 150 });
        throw new Error('Invalid replacement window');
      },
    });
    const onUsage = vi.fn();
    await expect(fixture.client.compactConversation?.({ ...request, onUsage, usageContext: { ...request.usageContext!, source: 'compaction' } }))
      .rejects.toThrow('Invalid replacement window');
    expect(onUsage).toHaveBeenCalledOnce();
    expect(fixture.records).toHaveLength(1);
    expect(fixture.records[0]).toMatchObject({ source: 'compaction', result: 'error', totalTokens: 150, requestCount: 1 });
  });
});

function tracked(inner: ModelClient, monotonicNow = () => 0) {
  const records: RuntimeUsageRecord[] = [];
  const client = new UsageTrackingModelClient(inner, {
    clock, monotonicNow,
    recorder: { async recordUsage(input) {
      const record = { id: `usage_${records.length}`, ...input };
      records.push(record);
      return record;
    } },
  });
  return { client, records };
}

async function consume(stream: AsyncGenerator<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
