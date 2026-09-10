import { FeatureOperationFailure, type FeatureOperationStreamFrame } from '@setsuna-desktop/feature-core/operation';

/** A request-scoped stream has one terminal result; a dropped connection must never resample it. */
export async function readRuntimeProgressResponse(response: Response, onProgress: (value: unknown) => void): Promise<unknown> {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    throw new Error(`Runtime progress request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Runtime generation stream ended before returning a result.');
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const frame = JSON.parse(line) as FeatureOperationStreamFrame;
        if (frame.type === 'error') throw new FeatureOperationFailure(frame.error);
        if (frame.type === 'result') return frame.value;
        if (frame.type !== 'progress') throw new Error('Invalid runtime progress frame.');
        onProgress(frame.value);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
