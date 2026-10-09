import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionApiResult, ExtensionTabReadDetails } from '../../src/contracts/extension-api.js';
import { installExtensionTabs } from '../../src/preload/extension-tabs.js';

vi.mock('electron', () => ({ contextBridge: {}, ipcRenderer: {} }));
afterEach(() => vi.unstubAllGlobals());

function fixture(nativeGet = vi.fn(async (_id: unknown) => ({ id: 10, active: true }))) {
  const runtime = {} as { lastError?: { message: string } };
  const nativeQuery = vi.fn(async (query: Record<string, unknown>): Promise<Array<Record<string, unknown> & { id: number }>> => query.url || query.title ? []
    : [{ id: 10, active: true, audible: false, mutedInfo: { muted: true } }]);
  const tabs = { get: nativeGet, query: nativeQuery } as Record<string, (...args: unknown[]) => unknown>;
  vi.stubGlobal('chrome', { tabs, runtime });
  const call = vi.fn<(method: string, args: unknown[]) => Promise<ExtensionApiResult>>().mockResolvedValue({ ok: true,
    result: [{ id: 10, windowId: 7, active: true, highlighted: true, url: 'https://private.test/', title: 'Private page' }] satisfies ExtensionTabReadDetails[] });
  installExtensionTabs({ call, onEvent: () => undefined });
  return { tabs, runtime, nativeGet, nativeQuery, call };
}

it('combines current host grants with native fields and queries beyond Chromium optional-permission filtering', async () => {
  const { tabs, nativeQuery, call } = fixture();
  expect(await tabs.get(10)).toEqual({ id: 10, windowId: 7, active: true, highlighted: true, url: 'https://private.test/', title: 'Private page' });
  const query = { url: ['https://private.test/*'], title: 'Private*', audible: false };
  expect(await tabs.query(query)).toEqual([{ id: 10, windowId: 7, active: true, highlighted: true, audible: false, mutedInfo: { muted: true },
    url: 'https://private.test/', title: 'Private page' }]);
  expect(nativeQuery.mock.calls).toEqual([[query], [{ ...query, url: undefined, title: undefined }]]);
  expect(call).toHaveBeenLastCalledWith('read', [[10], expect.objectContaining({ url: query.url, title: query.title })]);
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

it('uses the same host selection for active/inactive queries, get and unfiltered reads while preserving native fields and privacy', async () => {
  const { tabs, nativeGet, nativeQuery, call } = fixture();
  nativeGet.mockResolvedValue({ id: 10, active: false });
  nativeQuery.mockImplementation(async query => query.active
    ? [{ id: 99, active: true }] : [{ id: 10, active: false, audible: false, url: 'https://native-private.test/' }, { id: 11, active: true }]);
  call.mockImplementation(async (_method, [ids, query]) => {
    const filters = query as { active?: boolean } | undefined;
    return { ok: true, result: (ids as number[]).filter(id => filters?.active === undefined || filters.active === (id === 10))
      .map(id => ({ id, windowId: 7, active: id === 10, highlighted: id === 10 })) };
  });
  expect(await tabs.query({ active: true, currentWindow: true })).toEqual([
    { id: 10, windowId: 7, active: true, highlighted: true, audible: false },
  ]);
  expect(await tabs.query({ active: false, currentWindow: true })).toEqual([
    { id: 11, windowId: 7, active: false, highlighted: false },
  ]);
  expect(await tabs.get(10)).toEqual({ id: 10, windowId: 7, active: true, highlighted: true });
  expect(await tabs.query({})).toEqual([
    { id: 10, windowId: 7, active: true, highlighted: true, audible: false },
    { id: 11, windowId: 7, active: false, highlighted: false },
  ]);
});

it('returns no active tab when the host cleared selection even if Chromium still reports a focused popup', async () => {
  const { tabs, nativeQuery, call } = fixture();
  nativeQuery.mockResolvedValue([{ id: 99, active: true }]);
  call.mockResolvedValue({ ok: true, result: [] });
  expect(await tabs.query({ active: true, currentWindow: true })).toEqual([]);
  expect(call).toHaveBeenCalledExactlyOnceWith('read', [[99], expect.objectContaining({ active: true, currentWindow: true })]);
});

it('retains native extension-document matches and their fields while excluding documents outside the requested window or focus', async () => {
  const { tabs, nativeQuery, call } = fixture();
  const url = `chrome-extension://${'a'.repeat(32)}/options.html`;
  const current = { id: 20, windowId: 9, active: false, highlighted: false, url, title: 'Options' };
  const other = { ...current, id: 21, windowId: 10, active: true, highlighted: true };
  nativeQuery.mockImplementation(async query => query.url ? [] : [current, other].filter(tab =>
    (!query.currentWindow || tab.windowId === current.windowId)
    && (query.windowId === undefined || tab.windowId === query.windowId)
    && (query.active === undefined || tab.active === query.active)));
  call.mockResolvedValue({ ok: true, result: [current, other].map(({ id, url, title }) => ({ id, url, title })) });
  expect(await tabs.query({ url, currentWindow: true })).toEqual([current]);
  expect(await tabs.query({ url, windowId: 10, active: true })).toEqual([other]);
  expect(await tabs.query({ url, currentWindow: true, active: true })).toEqual([]);
  // Focus can change before the broad candidate read; preserve the original native snapshot.
  nativeQuery.mockResolvedValueOnce([current]).mockResolvedValueOnce([{ ...current, active: true }, other]);
  expect(await tabs.query({ currentWindow: true, active: false })).toEqual([current]);
});
