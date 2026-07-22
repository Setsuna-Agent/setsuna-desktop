import { describe, expect, it, vi } from 'vitest';
import { HttpBrowserControlClient } from '../../../src/adapters/browser/http-browser-control-client.js';

describe('HttpBrowserControlClient', () => {
  it('sends authenticated commands to the main-process bridge', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      result: { kind: 'tabs', tabs: [] },
    }), { status: 200 }));
    const client = new HttpBrowserControlClient('http://127.0.0.1:4567', 'secret', fetcher as typeof fetch);

    await expect(client.execute({ kind: 'tabs' })).resolves.toEqual({ kind: 'tabs', tabs: [] });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4567/v1/browser/command', expect.objectContaining({
      body: JSON.stringify({ kind: 'tabs' }),
      headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      method: 'POST',
    }));
  });

  it('rejects non-loopback endpoints', () => {
    expect(() => new HttpBrowserControlClient('https://example.com', 'secret')).toThrow('loopback HTTP');
  });

  it('accepts screenshot responses from the main-process bridge', async () => {
    const screenshot = {
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      height: 720,
      kind: 'screenshot',
      mimeType: 'image/png',
      size: 5,
      tabId: 'tab-1',
      title: 'Example',
      url: 'https://example.com/',
      width: 1280,
    } as const;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: screenshot }), { status: 200 }));
    const client = new HttpBrowserControlClient('http://127.0.0.1:4567', 'secret', fetcher as typeof fetch);

    await expect(client.execute({ kind: 'screenshot', tabId: 'tab-1' })).resolves.toEqual(screenshot);
  });
});
