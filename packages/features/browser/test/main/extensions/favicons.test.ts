import type { Extension, Session } from 'electron';
import { expect, it, vi } from 'vitest';
import { BrowserExtensionFavicons } from '../../../src/main/extensions/favicons.js';
import { loadBrowserFavicon } from '../../../src/main/favicon.js';

vi.mock('electron', () => ({ protocol: {} }));
vi.mock('../../../src/main/favicon.js', () => ({ loadBrowserFavicon: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') }));

function fixture() {
  const id = 'a'.repeat(32);
  let extension = { id, path: '/extension', version: '1.0', manifest: { permissions: [] } } as unknown as Extension;
  let handle: (request: Request) => Promise<Response>;
  const session = { protocol: { handle: (_scheme: string, handler: typeof handle) => { handle = handler; }, unhandle: vi.fn() } } as unknown as Session;
  const service = new BrowserExtensionFavicons({ session, resolve: () => extension }); service.start();
  const url = service.resourceUrl(extension, 'frame:1:1') + '?pageUrl=https%3A%2F%2Fwebsite.test%2F&size=32';
  return { service, url, serve: (resource = url, headers?: Record<string, string>, signal?: AbortSignal) => handle!(new Request(resource, { headers, signal })),
    grant: () => { extension = { ...extension, manifest: { ...extension.manifest, permissions: ['favicon'] } }; },
    revoke: () => { extension = { ...extension, manifest: { ...extension.manifest, permissions: [] } }; } };
}

it('requires an authenticated resource context and favicon grant, and rejects local URLs and document loads before fetching', async () => {
  const { service, grant, serve, url } = fixture();
  try {
    const fetched = vi.mocked(loadBrowserFavicon); fetched.mockClear();
    expect((await serve()).status).toBe(403); grant();
    expect((await serve(`setsuna-extension-favicon://${'a'.repeat(32)}/forged/?pageUrl=https://website.test`)).status).toBe(403);
    expect((await serve(url.replace('a'.repeat(32), 'b'.repeat(32)))).status).toBe(403);
    expect((await serve(url, { 'sec-fetch-dest': 'document' })).status).toBe(403);
    expect((await serve(url.replace('https%3A%2F%2Fwebsite.test%2F', 'file:///private/secret'))).status).toBe(400);
    expect(fetched).not.toHaveBeenCalled();
    const response = await serve();
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(fetched).toHaveBeenCalledWith(expect.anything(), 'https://website.test/', []);
    service.release('frame:1:1');
    expect((await serve()).status).toBe(403);
  } finally { service.dispose(); }
});

it('rechecks permission revocation and context destruction during a favicon fetch', async () => {
  const { service, grant, revoke, serve } = fixture();
  try {
    grant();
    let complete!: (value: string | null) => void;
    vi.mocked(loadBrowserFavicon).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = serve(); await Promise.resolve(); revoke(); complete('data:image/png;base64,iVBORw0KGgo=');
    expect((await pending).status).toBe(403);
    grant();
    vi.mocked(loadBrowserFavicon).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const closing = serve(); await Promise.resolve(); service.release('frame:1:1'); complete('data:image/png;base64,iVBORw0KGgo=');
    expect((await closing).status).toBe(403);
  } finally { service.dispose(); }
});

it('queues batches beyond the concurrency limit and releases slots after both success and failure', async () => {
  const { service, grant, serve, url } = fixture();
  const fetched = vi.mocked(loadBrowserFavicon); fetched.mockClear();
  const completions: Array<(value: string | null) => void> = [];
  let active = 0; let peak = 0;
  fetched.mockImplementation(() => {
    active++; peak = Math.max(peak, active);
    return new Promise<string | null>(resolve => { completions.push(value => { active--; resolve(value); }); });
  });
  try {
    grant();
    const responses = Array.from({ length: 40 }, (_, index) => {
      const resource = new URL(url); resource.searchParams.set('pageUrl', `https://website.test/${index}`);
      return serve(resource.href);
    });
    await vi.waitFor(() => expect(completions).toHaveLength(16));
    for (const complete of completions.slice(0, 16)) complete(null);
    await vi.waitFor(() => expect(completions).toHaveLength(32));
    for (const complete of completions.slice(16, 32)) complete('data:image/png;base64,iVBORw0KGgo=');
    await vi.waitFor(() => expect(completions).toHaveLength(40));
    for (const complete of completions.slice(32)) complete('data:image/png;base64,iVBORw0KGgo=');
    const results = await Promise.all(responses);
    expect(results.every(response => response.status === 200)).toBe(true);
    expect(peak).toBe(16);
    expect(fetched.mock.calls.map(([, page]) => page)).toEqual(Array.from({ length: 40 }, (_, index) => `https://website.test/${index}`));
  } finally {
    service.dispose();
    fetched.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
  }
});

it.each(['permission', 'context', 'dispose', 'abort'])('cancels invalid queued requests without starting another image fetch (%s)', async (reason) => {
  const { service, grant, revoke, serve, url } = fixture();
  const fetched = vi.mocked(loadBrowserFavicon); fetched.mockClear();
  const completions: Array<(value: string | null) => void> = [];
  fetched.mockImplementation(() => new Promise(resolve => { completions.push(resolve); }));
  try {
    grant();
    const active = Array.from({ length: 16 }, () => serve());
    await vi.waitFor(() => expect(completions).toHaveLength(16));
    const controller = new AbortController();
    const queued = serve(url, undefined, controller.signal);
    if (reason === 'permission') revoke();
    else if (reason === 'context') service.release('frame:1:1');
    else if (reason === 'dispose') service.dispose();
    else controller.abort();
    // Closing a context, disposing or aborting must release waiters immediately.
    if (reason !== 'permission') expect((await queued).status).toBe(403);
    for (const complete of completions) complete(null);
    await Promise.all(active);
    expect((await queued).status).toBe(403);
    expect(fetched).toHaveBeenCalledTimes(16);
  } finally {
    service.dispose();
    fetched.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
  }
});
