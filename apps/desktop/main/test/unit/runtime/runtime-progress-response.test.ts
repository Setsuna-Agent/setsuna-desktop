import { expect, it, vi } from 'vitest';
import { readRuntimeProgressResponse } from '../../../src/runtime/runtime-progress-response.js';

function streamedResponse(frames: unknown[]) {
  const bytes = new TextEncoder().encode(frames.map((frame) => JSON.stringify(frame) + '\n').join(''));
  return new Response(new ReadableStream({
    start(controller) {
      // Split both frame delimiters and multibyte characters across transport chunks.
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

it('decodes live UTF-8 snapshots and returns the complete multiline message', async () => {
  const progress = vi.fn();
  const result = { message: 'feat: 中文标题\n\n- 第一项改动' };
  await expect(readRuntimeProgressResponse(streamedResponse([
    { type: 'progress', value: { message: 'feat: 中文' } },
    { type: 'progress', value: result },
    { type: 'result', value: result },
  ]), progress)).resolves.toEqual(result);
  expect(progress.mock.calls).toEqual([[{ message: 'feat: 中文' }], [result]]);
});

it('rejects a partial response or provider failure instead of committing incomplete output', async () => {
  const progress = vi.fn();
  await expect(readRuntimeProgressResponse(streamedResponse([
    { type: 'progress', value: { message: 'partial' } },
  ]), progress)).rejects.toThrow('before returning a result');
  await expect(readRuntimeProgressResponse(streamedResponse([
    { type: 'error', error: { code: 'PROVIDER_UNAVAILABLE', message: 'Provider failed.', retryable: true } },
  ]), progress)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: 'Provider failed.' });
});
