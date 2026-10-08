import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppServerNotificationReader, createRuntimeEventReader } from './event-stream.js';
import { withTimeout } from './shared.js';

function controlledStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  return { reader: stream.getReader(), send: (text: string) => controller.enqueue(new TextEncoder().encode(text)) };
}

describe('runtime test event readers', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['runtime', 'app-server'] as const)('reads coalesced and split %s events without waiting for another chunk', async (kind) => {
    vi.useFakeTimers();
    const input = controlledStream();
    const runtime = createRuntimeEventReader(input.reader, 100);
    const appServer = createAppServerNotificationReader(input.reader, 100);
    const read = (method: string) => kind === 'runtime'
      ? runtime.readContains(`"method":"${method}"`)
      : appServer.readNotification((item) => item.method === method);
    try {
      input.send('data: {"method":"first"}\n\ndata: {"method":"second"}\n\ndata: {"method":');
      expect(await read('first')).toBeTruthy();
      // Zero additional bytes arrive between these assertions.
      expect(await read('second')).toBeTruthy();
      const third = read('third');
      input.send('"third"}\n\n');
      expect(await third).toBeTruthy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await input.reader.cancel();
    }
  });

  it.each(['runtime', 'app-server'] as const)('preserves the pending %s read after a timeout', async (kind) => {
    vi.useFakeTimers();
    const input = controlledStream();
    const runtime = createRuntimeEventReader(input.reader, 100);
    const appServer = createAppServerNotificationReader(input.reader, 100);
    const read = () => kind === 'runtime'
      ? runtime.readContains('arrived')
      : appServer.readNotification((item) => item.method === 'arrived');
    try {
      const expired = read();
      await vi.advanceTimersByTimeAsync(100);
      expect(await expired).toBeFalsy();
      input.send('data: {"method":"arrived"}\n\n');
      expect(await read()).toBeTruthy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await input.reader.cancel();
    }
  });

  it('reuses decoded output only for the matching command', async () => {
    vi.useFakeTimers();
    const input = controlledStream();
    const stream = createAppServerNotificationReader(input.reader, 100);
    try {
      input.send(`data: ${JSON.stringify({ method: 'output', params: { id: 'first', deltaBase64: Buffer.from('ready').toString('base64') } })}\n\n`);
      expect(await stream.readDecodedOutputContains('output', 'id', 'first', 'ready')).toBe(true);
      expect(await stream.readDecodedOutputContains('output', 'id', 'first', 'ready')).toBe(true);
      const other = stream.readDecodedOutputContains('output', 'id', 'second', 'ready');
      await vi.advanceTimersByTimeAsync(100);
      expect(await other).toBe(false);
    } finally {
      await stream.close();
    }
  });

  it('releases timeout timers after either success or failure', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve('done'), 10_000, 'timeout')).resolves.toBe('done');
    await expect(withTimeout(Promise.reject(new Error('failed')), 10_000, 'timeout')).rejects.toThrow('failed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
