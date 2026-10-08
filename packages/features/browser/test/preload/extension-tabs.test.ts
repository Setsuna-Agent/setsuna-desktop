import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionApiResult, ExtensionTabReadDetails } from '../../src/contracts/extension-api.js';
import { installExtensionTabs } from '../../src/preload/extension-tabs.js';

vi.mock('electron', () => ({ contextBridge: {}, ipcRenderer: {} }));
afterEach(() => vi.unstubAllGlobals());

function fixture(nativeGet = vi.fn(async (_id: unknown) => ({ id: 10, active: true }))) {
  const runtime = {} as { lastError?: { message: string } };
  const nativeQuery = vi.fn(async (query: { url?: unknown; title?: unknown }) => query.url || query.title ? []
    : [{ id: 10, active: true, audible: false, mutedInfo: { muted: true } }]);
  const tabs = { get: nativeGet, query: nativeQuery } as Record<string, (...args: unknown[]) => unknown>;
  vi.stubGlobal('chrome', { tabs, runtime });
  const call = vi.fn<(method: string, args: unknown[]) => Promise<ExtensionApiResult>>().mockResolvedValue({ ok: true,
    result: [{ id: 10, url: 'https://private.test/', title: 'Private page' }] satisfies ExtensionTabReadDetails[] });
  installExtensionTabs({ call, onEvent: () => undefined });
  return { tabs, runtime, nativeGet, nativeQuery, call };
}

it('combines current host grants with native fields and queries beyond Chromium optional-permission filtering', async () => {
  const { tabs, nativeQuery, call } = fixture();
  expect(await tabs.get(10)).toEqual({ id: 10, active: true, url: 'https://private.test/', title: 'Private page' });
  const query = { url: ['https://private.test/*'], title: 'Private*', audible: false };
  expect(await tabs.query(query)).toEqual([{ id: 10, active: true, audible: false, mutedInfo: { muted: true },
    url: 'https://private.test/', title: 'Private page' }]);
  expect(nativeQuery.mock.calls).toEqual([[query], [{ ...query, url: undefined, title: undefined }]]);
  expect(call).toHaveBeenLastCalledWith('read', [[10], { url: query.url, title: query.title }]);
  call.mockResolvedValue({ ok: true, result: [{ id: 10 }] });
  expect(await tabs.get(10)).toEqual({ id: 10, active: true });
});

it('preserves native validation and scopes read failures to callbacks lastError', async () => {
  const { tabs, runtime, nativeGet, nativeQuery, call } = fixture();
  nativeGet.mockImplementationOnce(() => { throw new TypeError('Invalid tab ID.'); });
  expect(() => tabs.get('invalid')).toThrow('Invalid tab ID.');
  expect(call).not.toHaveBeenCalled();
  nativeQuery.mockRejectedValueOnce(new Error('Invalid URL pattern.'));
  await expect(tabs.query({ url: 'invalid' })).rejects.toThrow('Invalid URL pattern.');
  expect(nativeQuery).toHaveBeenCalledOnce(); expect(call).not.toHaveBeenCalled();
  const callback = vi.fn();
  expect(tabs.get(10, callback)).toBeUndefined();
  await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: 'https://private.test/' })));
  call.mockResolvedValue({ ok: false, error: 'Extension context unavailable.' });
  const error = await new Promise<string | undefined>(resolve => tabs.get(10, () => resolve(runtime.lastError?.message)));
  expect(error).toBe('Extension context unavailable.'); expect(runtime.lastError).toBeUndefined();
});
