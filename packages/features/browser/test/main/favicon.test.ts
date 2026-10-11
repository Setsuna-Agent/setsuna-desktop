import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { loadBrowserFavicon, loadWebsiteFavicon } from '../../src/main/favicon.js';

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function faviconSession(
  fetchImplementation: (url: string, init?: RequestInit) => Promise<Response>,
): { fetch: Session['fetch']; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(fetchImplementation);
  return { fetch: spy as unknown as Session['fetch'], spy };
}

describe('loadBrowserFavicon', () => {
  it('uses the guest session and continues to the next candidate after a failed response', async () => {
    const session = faviconSession(async (url) => {
      if (url.endsWith('/missing.ico')) return new Response(null, { status: 404 });
      return new Response(pngBytes, { headers: { 'content-type': 'image/png' } });
    });

    await expect(loadBrowserFavicon(session, 'https://example.com/account', [
      'https://cdn.example.com/missing.ico',
      'https://cdn.example.com/icon.png',
    ])).resolves.toBe(`data:image/png;base64,${pngBytes.toString('base64')}`);

    expect(session.spy.mock.calls.map(([url]) => url)).toEqual([
      'https://cdn.example.com/missing.ico',
      'https://cdn.example.com/icon.png',
      'https://example.com/favicon.ico',
    ]);
  });

  it('falls back to the conventional origin favicon with browser credentials and referrer', async () => {
    const session = faviconSession(async () => new Response(pngBytes, {
      headers: { 'content-type': 'application/octet-stream' },
    }));

    await expect(loadBrowserFavicon(session, 'https://example.com/docs/page', [])).resolves.toBe(
      `data:image/png;base64,${pngBytes.toString('base64')}`,
    );
    expect(session.spy).toHaveBeenCalledWith('https://example.com/favicon.ico', expect.objectContaining({
      credentials: 'include',
      referrer: 'https://example.com/docs/page',
    }));
  });

  it('normalizes inline image data without making a network request', async () => {
    const session = faviconSession(async () => new Response(null, { status: 500 }));

    await expect(loadBrowserFavicon(session, 'https://example.com/', [
      'data:image/png;base64,iVBORw0KGgo=',
    ])).resolves.toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(session.spy).not.toHaveBeenCalled();
  });

  it('rejects non-image and oversized responses', async () => {
    const session = faviconSession(async (url) => {
      if (url.endsWith('/favicon.ico')) {
        return new Response(null, { headers: { 'content-length': '512001', 'content-type': 'image/png' } });
      }
      return new Response('<html>not an icon</html>', { headers: { 'content-type': 'text/html' } });
    });

    await expect(loadBrowserFavicon(session, 'https://example.com/', [
      'https://cdn.example.com/not-an-image',
    ])).resolves.toBeNull();
    expect(session.spy).toHaveBeenCalledTimes(2);
  });
});

describe('loadWebsiteFavicon', () => {
  it('discovers real icon links against the redirected page and HTML base, ignoring commented links and scripts', async () => {
    const session = faviconSession(async (url) => {
      if (url === 'https://example.com/start') {
        const response = new Response(`<html><head>
          <!-- <link rel="icon" href="https://wrong.example/comment.png"> -->
          <script>const text = '<link rel="icon" href="https://wrong.example/script.png">';</script>
          <base href="../assets/"><link rel="stylesheet" href="styles.css">
          <link rel="shortcut ICON" href="brand.png?v=1&amp;size=32">
          <link rel="apple-touch-icon" href="/touch.png">
          </head></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        Object.defineProperty(response, 'url', { value: 'https://login.example/app/home' });
        return response;
      }
      return url === 'https://login.example/assets/brand.png?v=1&size=32'
        ? new Response(pngBytes) : new Response(null, { status: 404 });
    });
    await expect(loadWebsiteFavicon(session, 'https://example.com/start')).resolves.toBe(`data:image/png;base64,${pngBytes.toString('base64')}`);
    expect(session.spy.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/start', 'https://login.example/assets/brand.png?v=1&size=32',
      'https://login.example/touch.png', 'https://login.example/favicon.ico',
    ]);
  });

  it.each(['unavailable', 'oversized'])('falls back to the origin icon when HTML is %s', async (kind) => {
    const session = faviconSession(async (url) => {
      if (url.endsWith('/favicon.ico')) return new Response(pngBytes);
      if (kind === 'unavailable') throw new Error('Connection reset');
      return new Response('<link rel="icon" href="/ignored.png">', {
        headers: { 'content-type': 'text/html', 'content-length': '1024001' },
      });
    });
    await expect(loadWebsiteFavicon(session, 'https://example.com/')).resolves.toBe(`data:image/png;base64,${pngBytes.toString('base64')}`);
    expect(session.spy.mock.calls.map(([url]) => url)).toEqual(['https://example.com/', 'https://example.com/favicon.ico']);
  });

  it('does not fetch non-web URLs or continue after scope cancellation', async () => {
    const controller = new AbortController();
    const session = faviconSession(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }));
    for (const url of ['file:///private/icon.png', 'javascript:alert(1)', 'https://user:password@example.com/']) {
      await expect(loadWebsiteFavicon(session, url)).resolves.toBeNull();
    }
    expect(session.spy).not.toHaveBeenCalled();
    const pending = loadWebsiteFavicon(session, 'https://example.com/', controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
    expect(session.spy).toHaveBeenCalledTimes(1);
  });
});
