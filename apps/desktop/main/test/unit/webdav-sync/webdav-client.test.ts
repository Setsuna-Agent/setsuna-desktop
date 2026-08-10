import { describe, expect, it } from 'vitest';
import { normalizeWebDavLocation } from '../../../src/webdav-sync/normalization.js';
import { WebDavClient } from '../../../src/webdav-sync/webdav-client.js';

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
});
