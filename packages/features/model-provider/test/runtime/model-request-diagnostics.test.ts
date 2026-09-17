import { describe, expect, it, vi } from 'vitest';
import type { ModelDiagnostic } from '@setsuna-desktop/contracts';
import { ModelRequestDiagnostics } from '../../src/runtime/model-request-diagnostics.js';

describe('model request diagnostics', () => {
  it('records HTTP attempts and first-chunk timing without changing bytes or logging secrets', async () => {
    const records: ModelDiagnostic[] = [];
    const diagnostics = new ModelRequestDiagnostics({ model: 'model', sessionId: 'thread', messages: [] }, (record) => records.push(record));
    const fetch = diagnostics.wrapFetch(async () => new Response('PRIVATE RESPONSE', { status: 200 }));
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch('https://example.test/?secret=PRIVATE URL', {
        method: 'POST', body: 'PRIVATE PROMPT', headers: { authorization: 'PRIVATE KEY' },
      });
      expect(await response.text()).toBe('PRIVATE RESPONSE');
    }
    expect(records.filter((record) => record.phase === 'http.started').map((record) => record.attempt)).toEqual([1, 2]);
    expect(records.filter((record) => record.phase === 'http.first_chunk')).toHaveLength(2);
    expect(records.filter((record) => record.phase === 'http.completed').map((record) => record.responseBytes)).toEqual([16, 16]);
    expect(new Set(records.map((record) => record.requestId)).size).toBe(1);
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
  });

  it('preserves stream cancellation, errors and a failing diagnostic sink', async () => {
    const cancel = vi.fn();
    const diagnostics = new ModelRequestDiagnostics({ model: 'model', messages: [] }, () => { throw new Error('sink failed'); });
    const wrapped = diagnostics.wrapFetch(async () => new Response(new ReadableStream({ cancel })));
    const response = await wrapped('https://example.test');
    await response.body!.cancel('stop');
    expect(cancel).toHaveBeenCalledWith('stop');

    const failure = new Error('PRIVATE PROVIDER ERROR');
    const broken = diagnostics.wrapFetch(async () => new Response(new ReadableStream({
      pull(controller) { controller.error(failure); },
    })));
    await expect((await broken('https://example.test')).text()).rejects.toBe(failure);
  });
});
