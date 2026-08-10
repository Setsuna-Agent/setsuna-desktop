import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeWebDavLocation } from '../../../src/webdav-sync/normalization.js';
import { WebDavClient } from '../../../src/webdav-sync/webdav-client.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WebDavClient', () => {
  it('uses file URLs without a collection trailing slash', async () => {
    const requestedPaths: string[] = [];
    const client = new WebDavClient(
      normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/backups' }),
      { username: 'alice', password: 'secret' },
      async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        requestedPaths.push(url.pathname);
        return init?.method === 'GET'
          ? new Response(new Uint8Array([1]), { status: 200 })
          : new Response(null, { status: 201 });
      },
    );

    await client.putBuffer(['objects', 'item.enc'], Buffer.from([1]));
    await client.getBuffer(['objects', 'item.enc']);

    expect(requestedPaths).toEqual([
      '/dav/backups/objects/item.enc',
      '/dav/backups/objects/item.enc',
    ]);
  });

  it('decodes XML entities once when listing remote paths', async () => {
    const client = new WebDavClient(
      normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
      { username: 'alice', password: 'secret' },
      async () => new Response(`<?xml version="1.0" encoding="utf-8"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/dav/Backups/literal&amp;lt;name</d:href>
            <d:propstat><d:prop><d:resourcetype /></d:prop></d:propstat>
          </d:response>
        </d:multistatus>`, { status: 207 }),
    );

    await expect(client.list([])).resolves.toEqual([{
      name: 'literal&lt;name',
      collection: false,
    }]);
  });

  it('stops streaming metadata once the configured limit is exceeded', async () => {
    const client = new WebDavClient(
      normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
      { username: 'alice', password: 'secret' },
      async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
          controller.close();
        },
      }), { status: 200 }),
    );

    await expect(client.getBuffer(['metadata'], { maxBytes: 4 }))
      .rejects.toThrow('超过安全大小限制');
  });

  it('keeps caller cancellation active while a response body is being read', async () => {
    let markBodyRead: (() => void) | undefined;
    const bodyRead = new Promise<void>((resolve) => { markBodyRead = resolve; });
    const client = new WebDavClient(
      normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
      { username: 'alice', password: 'secret' },
      async (_input, init) => {
        const requestSignal = init?.signal;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            requestSignal?.addEventListener('abort', () => {
              controller.error(requestSignal.reason);
            }, { once: true });
          },
          pull() {
            markBodyRead?.();
          },
        }), { status: 200 });
      },
    );
    const abort = new AbortController();
    const pending = client.getBuffer(['metadata'], { signal: abort.signal });
    await bodyRead;

    abort.abort(new Error('同步操作已取消。'));

    await expect(pending).rejects.toThrow('同步操作已取消');
  });

  it('uses an idle timeout instead of aborting an active long response', async () => {
    vi.useFakeTimers();
    try {
      const client = new WebDavClient(
        normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
        { username: 'alice', password: 'secret' },
        async (_input, init) => {
          const requestSignal = init?.signal;
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              const nextChunk = setTimeout(() => {
                controller.enqueue(new Uint8Array([2]));
              }, 20_000);
              const finalChunk = setTimeout(() => {
                controller.enqueue(new Uint8Array([3]));
                controller.close();
              }, 40_000);
              requestSignal?.addEventListener('abort', () => {
                clearTimeout(nextChunk);
                clearTimeout(finalChunk);
                controller.error(requestSignal.reason);
              }, { once: true });
            },
          }), { status: 200 });
        },
      );

      const pending = client.getBuffer(['metadata']);
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(pending).resolves.toEqual(Buffer.from([1, 2, 3]));
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes the idle timeout while a large request body is uploading', async () => {
    vi.useFakeTimers();
    try {
      const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-upload-'));
      temporaryRoots.push(root);
      const sourcePath = path.join(root, 'object.enc');
      await writeFile(sourcePath, Buffer.alloc(128 * 1024, 1));
      let markFirstChunk: (() => void) | undefined;
      let markSecondChunk: (() => void) | undefined;
      const firstChunk = new Promise<void>((resolve) => { markFirstChunk = resolve; });
      const secondChunk = new Promise<void>((resolve) => { markSecondChunk = resolve; });
      const client = new WebDavClient(
        normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
        { username: 'alice', password: 'secret' },
        async (_input, init) => {
          const body = init?.body as unknown as AsyncIterable<Uint8Array>;
          let chunkIndex = 0;
          for await (const _chunk of body) {
            chunkIndex += 1;
            if (chunkIndex === 1) markFirstChunk?.();
            if (chunkIndex === 2) markSecondChunk?.();
            await abortableDelay(20_000, init?.signal);
          }
          return new Response(null, { status: 201 });
        },
      );

      const pending = client.putFile(['object.enc'], sourcePath);
      await firstChunk;
      await vi.advanceTimersByTimeAsync(20_000);
      await secondChunk;
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns nested transport failures into actionable diagnostics', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND dav.invalid'), {
      code: 'ENOTFOUND',
    });
    const client = new WebDavClient(
      normalizeWebDavLocation({ endpoint: 'https://dav.invalid', remoteRoot: '/Backups' }),
      { username: 'alice', password: 'secret' },
      async () => { throw new Error('fetch failed', { cause }); },
    );

    await expect(client.test()).rejects.toThrow('无法解析服务器域名');
  });

  it('reports streamed bytes while downloading a backup object', async () => {
    const client = new WebDavClient(
      normalizeWebDavLocation({ endpoint: 'https://dav.test/dav', remoteRoot: '/Backups' }),
      { username: 'alice', password: 'secret' },
      async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
          controller.close();
        },
      }), { headers: { 'content-length': '6' }, status: 200 }),
    );
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-download-'));
    temporaryRoots.push(root);
    const destinationPath = path.join(root, 'object.enc');
    const progress: number[] = [];

    await client.downloadFile(['object.enc'], destinationPath, {
      maxBytes: 6,
      onProgress: (receivedBytes) => progress.push(receivedBytes),
    });

    expect(progress[0]).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(6);
    expect(await readFile(destinationPath)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  });
});

function abortableDelay(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
