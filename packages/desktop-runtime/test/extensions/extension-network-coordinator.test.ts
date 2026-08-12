import { describe, expect, it, vi } from 'vitest';
import { ExtensionNetworkCoordinator } from '../../src/extensions/extension-network-coordinator.js';

describe('extension network coordinator', () => {
  it('routes an allowed bounded request through the injected runtime fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const network = new ExtensionNetworkCoordinator(fetchImpl);

    const response = await network.request({
      url: 'https://api.example.test/search',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"query":"setsuna"}',
      timeoutMs: 1_000,
      maxResponseBytes: 4_096,
    }, { allowedOrigins: ['https://api.example.test'] });

    expect(Buffer.from(response.bodyBase64, 'base64').toString('utf8')).toBe('{"ok":true}');
    expect(response).toMatchObject({
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://api.example.test/search'),
      expect.objectContaining({ method: 'POST', redirect: 'manual' }),
    );
  });

  it('rejects undeclared origins before making a request', async () => {
    const fetchImpl = vi.fn(async () => new Response('unexpected'));
    const network = new ExtensionNetworkCoordinator(fetchImpl);

    await expect(network.request({
      url: 'https://other.example.test/search',
    }, { allowedOrigins: ['https://api.example.test'] })).rejects.toThrow('origin is not allowed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects responses larger than the extension-declared bound', async () => {
    const network = new ExtensionNetworkCoordinator(async () => new Response('oversized', {
      headers: { 'content-length': '9' },
    }));

    await expect(network.request({
      url: 'https://api.example.test/search',
      maxResponseBytes: 8,
    }, { allowedOrigins: ['https://api.example.test'] })).rejects.toThrow('exceeds 8 bytes');
  });
});
