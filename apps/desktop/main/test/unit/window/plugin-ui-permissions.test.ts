import { EventEmitter } from 'node:events';
import { dialog, type BrowserWindow, type Session, type WebContents, type WebFrameMain } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';
import { PluginUiDocuments } from '../../../src/window/plugin-ui-documents.js';
import { desktopWindows } from '../../../src/window/registry.js';

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }));
beforeEach(() => { vi.mocked(dialog.showMessageBox).mockReset().mockResolvedValue({ response: 1, checkboxChecked: false }); });

function fixture() {
  const setCheck = vi.fn(); const setRequest = vi.fn();
  const session = { setPermissionCheckHandler: setCheck, setPermissionRequestHandler: setRequest,
    protocol: { handle: vi.fn() } } as unknown as Session;
  const documents = new PluginUiDocuments(() => 'en-US');
  const owner = (id: number) => {
    const main = { framesInSubtree: [] as unknown as WebFrameMain[], url: 'file:///desktop.html' };
    const contents = Object.assign(new EventEmitter(), { id, session, mainFrame: main,
      isDestroyed: () => false, getURL: () => main.url });
    const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
    const page = documents.create(window as unknown as BrowserWindow, { storageKey: 'same-plugin', html: '' });
    const frame = { parent: main, url: page.url, detached: false } as unknown as WebFrameMain;
    main.framesInSubtree = [frame];
    return { page, frame, main, window, contents: contents as unknown as WebContents };
  };
  const first = owner(1); const other = owner(2);
  const request = setRequest.mock.calls[0][0] as NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
  const check = setCheck.mock.calls[0][0] as NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
  const details = { requestingUrl: first.page.url, isMainFrame: false };
  const query = (permission: Parameters<typeof check>[1], contents = first.contents, url = first.page.url, extra = {}) =>
    check(contents, permission, new URL(url).origin, { requestingUrl: url, isMainFrame: false, ...extra });
  return { first, other, documents, request, query, details };
}

it('requires approval for sensitive Plugin APIs and keeps camera, microphone and clipboard grants separate', async () => {
  const { first, other, request, query, details } = fixture();
  for (const permission of ['geolocation', 'clipboard-read', 'clipboard-sanitized-write', 'media'] as const) expect(query(permission)).toBe(false);
  const approved = vi.fn(allow => ({ allow, checked: query('media', first.contents, first.page.url, { mediaType: 'video' }) }));
  request(first.contents, 'media', approved, { ...details, mediaTypes: ['video'] });
  await Promise.resolve();
  expect(approved.mock.results[0].value).toEqual({ allow: true, checked: true });
  expect(query('media', first.contents, first.page.url, { mediaType: 'audio' })).toBe(false);
  expect(query('media', other.contents, other.page.url, { mediaType: 'video' })).toBe(false);
  request(first.contents, 'media', approved, { ...details, mediaTypes: ['video'] });
  expect(dialog.showMessageBox).toHaveBeenCalledOnce();
  const clipboard = vi.fn();
  request(first.contents, 'clipboard-read', clipboard, details);
  await Promise.resolve();
  expect(clipboard).toHaveBeenCalledWith(true);
  expect(query('clipboard-read')).toBe(true);
  expect(query('clipboard-sanitized-write')).toBe(false);
  vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
  const location = vi.fn();
  request(first.contents, 'geolocation', location, details);
  await Promise.resolve();
  expect(location).toHaveBeenCalledWith(false);
  expect(query('geolocation')).toBe(false);
});

it('denies unknown, foreign, remote, worker and ambiguous frame requests while preserving host clipboard writes', () => {
  const { first, other, request, query, details } = fixture();
  const denied = vi.fn();
  request(first.contents, 'unknown', denied, details);
  request(other.contents, 'clipboard-read', denied, details);
  request(first.contents, 'clipboard-read', denied, { ...details, requestingUrl: 'https://remote.test/' });
  expect(query('clipboard-read', null as unknown as WebContents)).toBe(false);
  expect(query('clipboard-read', first.contents, first.page.url, { requestingUrl: undefined })).toBe(false);
  first.main.framesInSubtree.push({ ...first.frame } as WebFrameMain);
  request(first.contents, 'clipboard-read', denied, details);
  expect(denied.mock.calls).toEqual([[false], [false], [false], [false]]);
  expect(dialog.showMessageBox).not.toHaveBeenCalled();
  const write = vi.fn();
  request(first.contents, 'clipboard-sanitized-write', write, { isMainFrame: true, requestingUrl: first.main.url });
  expect(write).toHaveBeenCalledWith(true);
  const contents = Object.assign(new EventEmitter(), { id: 3, session: first.contents.session, isDestroyed: () => false,
    getURL: () => first.main.url });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  desktopWindows.add(window as unknown as BrowserWindow);
  request(contents as unknown as WebContents, 'clipboard-sanitized-write', write, { isMainFrame: true, requestingUrl: first.main.url });
  expect(write.mock.calls).toEqual([[true], [true]]);
  window.emit('closed');
});

it.each(['reload', 'release', 'closed', 'destroyed', 'render-process-gone'] as const)(
  'revokes grants and pending approval on %s without accepting a late answer', async reason => {
    const { first, documents, request, query, details } = fixture();
    request(first.contents, 'clipboard-read', vi.fn(), details);
    await Promise.resolve();
    expect(query('clipboard-read')).toBe(true);
    first.contents.emit('did-start-navigation', { isSameDocument: true, isMainFrame: false, frame: first.frame });
    expect(query('clipboard-read')).toBe(true);
    let accept!: (answer: { response: number; checkboxChecked: boolean }) => void;
    vi.mocked(dialog.showMessageBox).mockImplementation(() => new Promise(resolve => { accept = resolve; }));
    const pending = vi.fn();
    request(first.contents, 'geolocation', pending, details);
    if (reason === 'reload') first.contents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: false, frame: first.frame });
    else if (reason === 'release') documents.release(first.contents.id, first.page.id);
    else (reason === 'closed' ? first.window : first.contents).emit(reason);
    accept({ response: 1, checkboxChecked: false });
    await Promise.resolve();
    expect(pending.mock.calls).toEqual([[false]]);
    expect(query('clipboard-read')).toBe(false);
    expect(query('geolocation')).toBe(false);
    if (reason === 'release') expect(query('clipboard-sanitized-write', first.contents, first.main.url, { isMainFrame: true })).toBe(true);
  },
);
