import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { loadBrowserFavicon } from './browser-favicon.js';

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
