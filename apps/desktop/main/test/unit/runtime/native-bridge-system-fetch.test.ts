import {
  DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES,
  type DesktopSystemProxyFetchRequest,
} from '@setsuna-desktop/contracts';
import { createServer, request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';
import { serveDesktopSystemProxyFetch } from '../../../src/runtime/native-bridge-system-fetch.js';

describe('serveDesktopSystemProxyFetch', () => {
  it('settles a backpressured response when the bridge client disconnects', async () => {
    let handlerSettled!: () => void;
    const settled = new Promise<void>((resolve) => { handlerSettled = resolve; });
    let upstreamAborted = false;
    const server = createServer((request, response) => {
      void serveDesktopSystemProxyFetch(request, response, async (_input, init) => {
        const signal = init?.signal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener('abort', () => {
              upstreamAborted = true;
              controller.error(signal.reason);
            }, { once: true });
          },
          pull(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
        }));
      }).then(handlerSettled, handlerSettled);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected bridge backpressure test address.');

    const client = httpRequest({
      host: '127.0.0.1',
      method: 'POST',
      path: '/',
      port: address.port,
    }, (response) => {
      response.pause();
      setTimeout(() => response.destroy(), 20).unref();
    });
    client.on('error', () => undefined);
    client.end(systemFetchFrame({
      headers: [],
      method: 'GET',
      url: 'https://api.example.com/large-response',
    }));

    try {
      await Promise.race([
        settled,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Bridge handler did not settle after disconnect.')), 2_000).unref();
        }),
      ]);
      expect(upstreamAborted).toBe(true);
    } finally {
      client.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

function systemFetchFrame(metadata: DesktopSystemProxyFetchRequest): Buffer {
  const metadataBytes = Buffer.from(JSON.stringify(metadata), 'utf8');
  const prefix = Buffer.alloc(DESKTOP_SYSTEM_PROXY_FETCH_METADATA_PREFIX_BYTES);
  prefix.writeUInt32BE(metadataBytes.length, 0);
  return Buffer.concat([prefix, metadataBytes]);
}
