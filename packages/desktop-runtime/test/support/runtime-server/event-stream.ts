import type { AppServerStreamNotification, RuntimeEventStream } from './shared.js';

// A timed-out read still owns the next chunk. Reuse it so a later assertion
// cannot lose data, and clear deadline timers as soon as a chunk arrives.
function createChunkReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  return async (deadline: number) => {
    if (Date.now() >= deadline) return null;
    pending ??= reader.read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        pending,
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), deadline - Date.now()); }),
      ]);
      if (result) pending = undefined;
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createRuntimeEventReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): RuntimeEventStream {
  const readChunk = createChunkReader(reader);
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async readContains(needle, options = {}) {
      const deadline = Date.now() + (options.timeoutMs ?? timeoutMs);
      while (!buffer.includes(needle)) {
        const result = await readChunk(deadline);
        if (!result || result.done) return false;
        buffer += decoder.decode(result.value, { stream: true });
      }
      return true;
    },
    close: () => reader.cancel(),
  };
}

export function createAppServerNotificationReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
) {
  const readChunk = createChunkReader(reader);
  const decoder = new TextDecoder();
  let buffer = '';
  const outputs = new Map<string, string>();
  const readNotification = async (
    predicate: (notification: AppServerStreamNotification) => boolean,
    options: { timeoutMs?: number } = {},
  ): Promise<AppServerStreamNotification | null> => {
    const deadline = Date.now() + (options.timeoutMs ?? timeoutMs);
    for (;;) {
      // Consume complete buffered events before waiting for more network data.
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = rawEvent.split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice('data: '.length)).join('\n');
        if (!data) continue;
        const notification = JSON.parse(data) as AppServerStreamNotification;
        if (predicate(notification)) return notification;
      }
      const result = await readChunk(deadline);
      if (!result || result.done) return null;
      buffer += decoder.decode(result.value, { stream: true });
    }
  };
  return {
    readNotification,
    async readDecodedOutputContains(
      method: string, idKey: string, idValue: string, needle: string,
      options: { timeoutMs?: number } = {},
    ) {
      const key = JSON.stringify([method, idKey, idValue]);
      let output = outputs.get(key) ?? '';
      const deadline = Date.now() + (options.timeoutMs ?? timeoutMs);
      while (!output.includes(needle)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        const notification = await readNotification((item) => (
          item.method === method && item.params?.[idKey] === idValue
          && typeof item.params.deltaBase64 === 'string'
        ), { timeoutMs: remaining });
        if (!notification) return false;
        output += Buffer.from(notification.params!.deltaBase64, 'base64').toString('utf8');
        outputs.set(key, output);
      }
      return true;
    },
    close: () => reader.cancel(),
  };
}
