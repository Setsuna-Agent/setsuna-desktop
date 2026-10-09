import { EventEmitter } from 'node:events';
import type { BrowserWindow, Extension, Session, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionTabEvent } from '../../../src/contracts/extension-api.js';
import type { ExtensionEndpoint } from '../../../src/main/extensions/contexts.js';
import { BrowserExtensionTabs } from '../../../src/main/extensions/tabs.js';
import type { BrowserExtensionPages } from '../../../src/main/extensions/pages.js';

const transport = vi.hoisted(() => ({ endpoints: vi.fn(), fromId: vi.fn(), frameContents: vi.fn(() => null), call: vi.fn() }));
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => null }, nativeImage: {}, webContents: { fromId: transport.fromId } }));
vi.mock('../../../src/main/extensions/contexts.js', () => ({ ExtensionContexts: class {
  constructor(options: { call: (...args: unknown[]) => unknown }) { transport.call.mockImplementation(options.call); }
  endpoints = transport.endpoints;
  frameContents = transport.frameContents;
  dispose() {}
} }));
afterEach(() => vi.clearAllMocks());

function fixture(permissions: string[], host_permissions: string[] = [], activeTab = false) {
  let extension = { id: 'a'.repeat(32), manifest: { permissions, host_permissions } } as Extension;
  let url = 'https://private.test/'; let title = 'Private title'; let temporary = activeTab;
  const session = { isPersistent: () => true, extensions: { getAllExtensions: () => [extension] } } as unknown as Session;
  const contents = Object.assign(new EventEmitter(), { id: 10, session, isDestroyed: () => false,
    isFocused: () => true, getType: () => 'webview', getURL: () => url, getTitle: () => title, isLoadingMainFrame: () => false }) as unknown as WebContents;
  const owner = { id: 1, isDestroyed: () => false } as BrowserWindow;
  const tabs = new BrowserExtensionTabs({ session, resolve: () => extension, owner: () => owner,
    activeOwner: () => owner, activeTabAccess: () => temporary, pages: {} as BrowserExtensionPages });
  tabs.track(contents); transport.fromId.mockImplementation(id => id === contents.id ? contents : null);
  const send = vi.fn();
  const endpoint = { key: 'worker', send, hold: () => () => {} } satisfies ExtensionEndpoint<ExtensionTabEvent>;
  transport.endpoints.mockResolvedValue([endpoint]);
  return { tabs, contents, send, endpoint,
    owner, active: async (query: object) => (await transport.call(extension, 'worker', 'read', [[10, 11], { ...query, active: true }]))
      .filter(({ active }: { active?: boolean }) => active === true)
      .map(({ id, windowId }: { id: number; windowId: number }) => ({ id, windowId })),
    read: (ids: number[], query?: unknown) => transport.call(extension, '', 'read', [ids, query]),
    revoke: () => { extension = { ...extension, manifest: { permissions: [], host_permissions: [] } }; temporary = false; },
    navigate: (next: string) => { url = next; title = `Title ${next}`; } };
}

it.each(['tabs', 'host', 'activeTab'])('reads and queries private tab fields using current grants (%s)', async grant => {
  const { tabs, contents, owner, read, revoke } = fixture(grant === 'tabs' ? ['tabs'] : [],
    grant === 'host' ? ['https://private.test/*'] : [], grant === 'activeTab');
  try {
    expect(await read([contents.id])).toEqual([{ id: contents.id, windowId: owner.id, active: true, highlighted: true, url: contents.getURL(), title: contents.getTitle() }]);
    expect(await read([contents.id], { url: 'https://private.test/*', title: 'Private*' })).toHaveLength(1);
    expect(await read([contents.id], { title: 'Private? title' })).toHaveLength(1);
    expect(await read([contents.id], { title: 'Private\\ title' })).toHaveLength(1);
    expect(await read([contents.id], { url: 'https://other.test/*' })).toEqual([]);
    expect(await read([contents.id], { title: 'Other*' })).toEqual([]);
    expect(await read([contents.id], { title: '' })).toEqual([]);
    transport.fromId.mockReturnValue({ ...contents, session: {} });
    expect(await read([contents.id])).toEqual([{ id: contents.id }]);
    transport.fromId.mockReturnValue(contents);
    revoke();
    expect(await read([contents.id])).toEqual([{ id: contents.id, windowId: owner.id, active: true, highlighted: true }]);
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

it('keeps selection within its browser owner and forgets a destroyed target', async () => {
  const { tabs, contents, owner, active } = fixture(['tabs']);
  try {
    expect(tabs.select({ id: 2, isDestroyed: () => false } as BrowserWindow, contents.id)).toBe(false);
    expect(tabs.select(owner, 99)).toBe(false);
    expect(tabs.select(owner, contents.id)).toBe(true);
    expect(await active({ currentWindow: true })).toEqual([{ id: contents.id, windowId: owner.id }]);
    expect(await active({ windowId: -2 })).toEqual([{ id: contents.id, windowId: owner.id }]);
    expect(await active({ windowId: 2 })).toEqual([]);
    contents.emit('destroyed');
    expect(await active({ currentWindow: true })).toEqual([]);
    expect(tabs.select(owner, contents.id)).toBe(false);
  } finally { tabs.dispose(); }
});

it('uses explicit host selection over stale focus and leaves no active guest after clearing it', async () => {
  const { tabs, contents, owner, active, read, send } = fixture(['tabs']);
  const second = Object.assign(new EventEmitter(), { id: 11, session: contents.session, isDestroyed: () => false,
    getType: () => 'webview', isFocused: () => false, getURL: () => 'https://second.test/', getTitle: () => 'Second' }) as unknown as WebContents;
  tabs.track(second);
  transport.fromId.mockImplementation(id => id === contents.id ? contents : id === second.id ? second : null);
  try {
    expect(await active({ currentWindow: true })).toEqual([{ id: contents.id, windowId: owner.id }]);
    expect(tabs.select(owner, second.id)).toBe(true);
    contents.emit('focus');
    expect(await active({ currentWindow: true })).toEqual([{ id: second.id, windowId: owner.id }]);
    expect(await read([contents.id])).toEqual([expect.objectContaining({ active: false, highlighted: false, windowId: owner.id })]);
    expect(await read([contents.id, second.id], { active: false })).toEqual([expect.objectContaining({ id: contents.id, active: false })]);
    expect(await read([contents.id, second.id], { highlighted: true })).toEqual([expect.objectContaining({ id: second.id, active: true })]);
    second.emit('did-finish-load');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0][0].tab).toMatchObject({ id: second.id, active: true, highlighted: true });
    expect(tabs.select(owner, null)).toBe(true);
    expect(await active({ currentWindow: true })).toEqual([]);
    expect(await read([contents.id, second.id], { active: false })).toHaveLength(2);
    tabs.select(owner, second.id); second.emit('destroyed');
    expect(await active({ currentWindow: true })).toEqual([]);
  } finally { tabs.dispose(); }
});

it('delegates extension-document selection to native queries while enforcing URL and title permissions', async () => {
  const { tabs, contents, read } = fixture([]);
  const url = `chrome-extension://${'a'.repeat(32)}/options.html`;
  const document = Object.assign(new EventEmitter(), { id: 20, session: contents.session, isDestroyed: () => false,
    getType: () => 'window', isFocused: () => false, getURL: () => url, getTitle: () => 'Options' }) as unknown as WebContents;
  transport.fromId.mockImplementation(id => id === document.id ? document : null);
  try {
    expect(await read([document.id], { url, title: 'Options', currentWindow: true, windowId: 9, active: false, highlighted: false }))
      .toEqual([{ id: document.id, url, title: 'Options' }]);
    expect(await read([document.id], { url: 'https://other.test/*' })).toEqual([]);
    transport.fromId.mockReturnValue({ ...document, getURL: () => `chrome-extension://${'b'.repeat(32)}/options.html` });
    expect(await read([document.id], { currentWindow: true })).toEqual([{ id: document.id }]);
    expect(await read([document.id], { url: '<all_urls>' })).toEqual([]);
  } finally { tabs.dispose(); }
});
