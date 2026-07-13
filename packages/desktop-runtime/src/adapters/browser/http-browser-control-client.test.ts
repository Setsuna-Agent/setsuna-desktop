import { describe, expect, it, vi } from 'vitest';
import { HttpBrowserControlClient } from './http-browser-control-client.js';

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
});

