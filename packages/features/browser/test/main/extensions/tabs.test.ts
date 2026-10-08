import { EventEmitter } from 'node:events';
import type { BrowserWindow, Extension, Session, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionTabEvent } from '../../../src/contracts/extension-api.js';
import type { ExtensionEndpoint } from '../../../src/main/extensions/contexts.js';
import { BrowserExtensionTabs } from '../../../src/main/extensions/tabs.js';
import type { BrowserExtensionPages } from '../../../src/main/extensions/pages.js';

const transport = vi.hoisted(() => ({ endpoints: vi.fn(), fromId: vi.fn(), call: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: {}, nativeImage: {}, webContents: { fromId: transport.fromId } }));
vi.mock('../../../src/main/extensions/contexts.js', () => ({ ExtensionContexts: class {
  constructor(options: { call: (...args: unknown[]) => unknown }) { transport.call.mockImplementation(options.call); }
  endpoints = transport.endpoints;
  dispose() {}
} }));
afterEach(() => vi.clearAllMocks());

function fixture(permissions: string[], host_permissions: string[] = [], activeTab = false) {
  let extension = { id: 'a'.repeat(32), manifest: { permissions, host_permissions } } as Extension;
  let url = 'https://private.test/'; let title = 'Private title'; let temporary = activeTab;
  const session = { isPersistent: () => true, extensions: { getAllExtensions: () => [extension] } } as unknown as Session;
  const contents = Object.assign(new EventEmitter(), { id: 10, session, isDestroyed: () => false,
    isFocused: () => true, getURL: () => url, getTitle: () => title, isLoadingMainFrame: () => false }) as unknown as WebContents;
  const owner = { id: 1, isDestroyed: () => false } as BrowserWindow;
  const tabs = new BrowserExtensionTabs({ session, resolve: () => extension, owner: () => owner,
    activeOwner: () => owner, activeTabAccess: () => temporary, pages: {} as BrowserExtensionPages });
  tabs.track(contents); transport.fromId.mockImplementation(id => id === contents.id ? contents : null);
  const send = vi.fn();
  const endpoint = { key: 'worker', send, hold: () => () => {} } satisfies ExtensionEndpoint<ExtensionTabEvent>;
  transport.endpoints.mockResolvedValue([endpoint]);
  return { tabs, contents, send, endpoint,
    read: (ids: number[], query?: unknown) => transport.call(extension, '', 'read', [ids, query]),
    revoke: () => { extension = { ...extension, manifest: { permissions: [], host_permissions: [] } }; temporary = false; },
    navigate: (next: string) => { url = next; title = `Title ${next}`; } };
}

it.each(['tabs', 'host', 'activeTab'])('reads and queries private tab fields using current grants (%s)', async grant => {
  const { tabs, contents, read, revoke } = fixture(grant === 'tabs' ? ['tabs'] : [],
    grant === 'host' ? ['https://private.test/*'] : [], grant === 'activeTab');
  try {
    expect(await read([contents.id])).toEqual([{ id: contents.id, url: contents.getURL(), title: contents.getTitle() }]);
    expect(await read([contents.id], { url: 'https://private.test/*', title: 'Private*' })).toHaveLength(1);
    expect(await read([contents.id], { title: 'Private? title' })).toHaveLength(1);
    expect(await read([contents.id], { title: 'Private\\ title' })).toHaveLength(1);
    expect(await read([contents.id], { url: 'https://other.test/*' })).toEqual([]);
    expect(await read([contents.id], { title: 'Other*' })).toEqual([]);
    transport.fromId.mockReturnValue({ ...contents, session: {} });
    expect(await read([contents.id])).toEqual([{ id: contents.id }]);
    transport.fromId.mockReturnValue(contents);
    revoke();
    expect(await read([contents.id])).toEqual([{ id: contents.id }]);
    expect(await read([contents.id], { url: '<all_urls>' })).toEqual([]);
  } finally { tabs.dispose(); }
});

it.each(['tabs', 'host', 'activeTab'])('filters sensitive event fields after authority is revoked during worker startup (%s)', async (grant) => {
  const { tabs, contents, send, endpoint, revoke } = fixture(grant === 'tabs' ? ['tabs'] : [],
    grant === 'host' ? ['https://private.test/*'] : [], grant === 'activeTab');
  let started!: (endpoints: ExtensionEndpoint<ExtensionTabEvent>[]) => void;
  transport.endpoints.mockReturnValueOnce(new Promise(done => { started = done; }));
  try {
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'https://private.test/pending' });
    await vi.waitFor(() => expect(transport.endpoints).toHaveBeenCalledOnce());
    revoke(); started([endpoint]);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][0]).toEqual({ kind: 'updated', tabId: 10, changeInfo: { status: 'loading' },
      tab: { id: 10, windowId: 1, index: 0, active: true, highlighted: true, pinned: false, incognito: false, status: 'loading' } });
    contents.emit('did-finish-load');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0].changeInfo).toEqual({ status: 'complete' });
    expect(send.mock.calls[1][0].tab).not.toHaveProperty('url');
    expect(send.mock.calls[1][0].tab).not.toHaveProperty('title');
  } finally { tabs.dispose(); }
});

it('retains navigation snapshots and their order while filtering each with current grants', async () => {
  const { tabs, contents, send, endpoint, navigate } = fixture([], ['https://private.test/*']);
  let started!: (endpoints: ExtensionEndpoint<ExtensionTabEvent>[]) => void;
  transport.endpoints.mockReturnValueOnce(new Promise(done => { started = done; }));
  try {
    contents.emit('did-finish-load');
    await vi.waitFor(() => expect(transport.endpoints).toHaveBeenCalledOnce());
    navigate('https://other.test/'); contents.emit('did-finish-load');
    started([endpoint]);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[0][0]).toMatchObject({ changeInfo: { url: 'https://private.test/' },
      tab: { url: 'https://private.test/', title: 'Private title' } });
    expect(send.mock.calls[1][0]).toMatchObject({ changeInfo: { status: 'complete' } });
    expect(send.mock.calls[1][0].tab).not.toHaveProperty('url');
    expect(send.mock.calls[1][0].tab).not.toHaveProperty('title');
  } finally { tabs.dispose(); }
});
