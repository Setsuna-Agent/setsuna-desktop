import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeWebDavLocation } from '../../../src/webdav-sync/normalization.js';
import { WebDavClient } from '../../../src/webdav-sync/webdav-client.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WebDavClient response limits', () => {
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
