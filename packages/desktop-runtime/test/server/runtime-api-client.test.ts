import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApiClient } from '../../src/server/runtime-api-client.js';

describe('runtime API transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('binds requests to the host origin and authentication, preserving backend errors', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error: 'No such thread' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetch);
    const api = createRuntimeApiClient({ baseUrl: () => 'http://127.0.0.1:9999', token: 'host-secret' });
    const controller = new AbortController();
    expect(await api.request({ path: '/v1/threads/missing?messageLimit=10' }, controller.signal)).toEqual({
      ok: false, status: 404, data: { error: 'No such thread' },
    });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9999/v1/threads/missing?messageLimit=10', expect.objectContaining({
      redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer host-secret' }),
    }));
    const signal = fetch.mock.calls[0][1]?.signal;
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('rejects external, internal and recursive transport targets before sending credentials', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const api = createRuntimeApiClient({ baseUrl: () => 'http://127.0.0.1:9999', token: 'host-secret' });
    for (const target of [
      'https://example.com/v1/projects', '//example.com/v1/projects',
      '/v1/../../internal/secrets', '/v1/..%2f..%2fnot-a-route\\x',
      '/v1/features/plugin-management/installed/app/renderer-ui/runtime-request?x=1',
    ]) await expect(api.request({ path: target })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('transports binary resources without corrupting them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0, 128, 255]), {
      headers: { 'content-type': 'image/png' },
    })));
    const api = createRuntimeApiClient({ baseUrl: () => 'http://127.0.0.1:9999', token: 'host-secret' });
    expect(await api.request({ path: '/v1/threads/chat/attachments/image' })).toMatchObject({
      ok: true, data: { mimeType: 'image/png', base64: 'AID/' },
    });
  });

  it('blocks local bundle import and the uncoordinated RPC deletion alias before forwarding', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const api = createRuntimeApiClient({ baseUrl: () => 'http://127.0.0.1:9999', token: 'host-secret' });
    for (const path of [
      '/v1/features/plugin-management/install-local',
      '/v1/features/plugin-management/install-local?source=app',
      '/v1/features/plugin-management/installed/%2e%2e/install-local',
    ]) await expect(api.request({ path, method: 'POST', body: { path: '/private/bundle' } })).rejects.toThrow('directory picker');
    await expect(api.request({
      path: '/v1/swe/app-server?connectionId=app', method: 'POST',
      body: { id: 1, method: 'thread/delete', params: { threadId: 'thread_1' } },
    })).rejects.toThrow('coordinated');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('delegates canonical thread deletion to the desktop and preserves cancellation and failures without a fallback', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const deleteThread = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ cancelled: true })
      .mockRejectedValueOnce(new Error('Other window is saving'));
    const api = createRuntimeApiClient({ baseUrl: () => 'http://127.0.0.1:9999', token: 'host-secret', deleteThread });
    const input = { path: '/v1/projects/../threads/%74hread_1?source=app', method: 'DELETE' as const };
    const controller = new AbortController();
    await expect(api.request(input, controller.signal)).resolves.toEqual({ ok: true, status: 200, data: { ok: true } });
    expect(deleteThread).toHaveBeenLastCalledWith('thread_1', expect.any(AbortSignal));
    controller.abort();
    expect(deleteThread.mock.calls[0][1].aborted).toBe(true);
    await expect(api.request(input)).resolves.toEqual({ ok: false, status: 409, data: { cancelled: true } });
    await expect(api.request(input)).rejects.toThrow('saving');
    await expect(api.request(input, controller.signal)).rejects.toThrow();
    await expect(api.request({ path: '/v1/threads/a%2Fb', method: 'DELETE' })).rejects.toThrow();
    const headless = createRuntimeApiClient({ baseUrl: () => 'http://127.0.0.1:9999', token: 'host-secret' });
    await expect(headless.request(input)).rejects.toThrow('Desktop host');
    expect(deleteThread).toHaveBeenCalledTimes(3);
    expect(fetch).not.toHaveBeenCalled();
  });
});
