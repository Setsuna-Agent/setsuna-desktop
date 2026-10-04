import { EventEmitter } from 'node:events';
import { dialog, type BrowserWindow, type Session, type WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferencesPatch } from '../../../src/contracts/settings.js';
import { installBrowserPermissions, browserPermissionPolicy, requestedBrowserPermissions } from '../../../src/main/settings/permissions.js';
import { patchBrowserPreferences, type BrowserPreferencesStore } from '../../../src/main/settings/preferences.js';

vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }));

it('keeps camera and microphone grants separate and gives the exact website rule precedence', () => {
  const settings = { ...DEFAULT_BROWSER_PREFERENCES, sitePermissions: { 'https://example.com': { camera: 'allow' as const } } };
  expect(browserPermissionPolicy(settings, 'https://example.com', requestedBrowserPermissions('media', ['video']))).toBe('allow');
  expect(browserPermissionPolicy(settings, 'https://example.com', requestedBrowserPermissions('media', ['video', 'audio']))).toBe('block');
  expect(browserPermissionPolicy(settings, 'https://example.com', requestedBrowserPermissions('media'))).toBe('block');
  expect(browserPermissionPolicy(settings, 'https://other.example', ['camera'])).toBe('block');
  expect(browserPermissionPolicy(settings, 'https://example.com', requestedBrowserPermissions('usb'))).toBe('block');
});

it('denies guests outside the browser and cross-origin frames, and invalidates permission prompts on same-URL navigation', async () => {
  const setRequest = vi.fn(); const setCheck = vi.fn();
  const session = { setPermissionRequestHandler: setRequest, setPermissionCheckHandler: setCheck } as unknown as Session;
  const owner = { isDestroyed: () => false } as BrowserWindow;
  const contents = Object.assign(new EventEmitter(), { id: 7, session, isDestroyed: () => false, getURL: () => 'https://example.com/' }) as unknown as WebContents;
  const preferences = { subscribe: () => () => undefined, get: () => ({ ...DEFAULT_BROWSER_PREFERENCES, permissions: { ...DEFAULT_BROWSER_PREFERENCES.permissions, camera: 'ask' } }) } as unknown as BrowserPreferencesStore;
  const dispose = installBrowserPermissions(session, preferences, (guest) => guest === contents ? owner : null, () => 'en-US');
  const request = setRequest.mock.calls[0][0];
  const check = setCheck.mock.calls[0][0];
  const details = { requestingUrl: 'https://example.com/', isMainFrame: true, mediaTypes: ['video'] };
  let resolve!: (value: { response: number }) => void;
  vi.mocked(dialog.showMessageBox).mockImplementation(() => new Promise((accept) => { resolve = accept; }) as never);
  try {
    const denied = vi.fn();
    request(contents, 'media', denied, { ...details, isMainFrame: false });
    request(contents, 'media', denied, { ...details, requestingUrl: 'https://evil.example/' });
    expect(denied.mock.calls).toEqual([[false], [false]]);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(check(null, 'media', 'https://example.com', { isMainFrame: true, mediaType: 'video' })).toBe(false);
    const answer = vi.fn();
    request(contents, 'media', answer, details);
    contents.emit('did-start-navigation', {}, 'https://example.com/', false, true);
    resolve({ response: 1 });
    await Promise.resolve();
    expect(answer.mock.calls).toEqual([[false]]);
    expect(contents.listenerCount('did-start-navigation')).toBe(0);
    const allowed = vi.fn();
    request(contents, 'media', allowed, details);
    resolve({ response: 1 });
    await Promise.resolve();
    expect(allowed.mock.calls).toEqual([[true]]);
    expect(check(contents, 'media', details.requestingUrl, { isMainFrame: true, mediaType: 'video' })).toBe(true);
    expect(check(contents, 'media', details.requestingUrl, { isMainFrame: true, mediaType: 'audio' })).toBe(false);
  } finally { dispose(); }
});

it('exposes Allow once to permission checks before answering the request, only in the requesting document', async () => {
  vi.mocked(dialog.showMessageBox).mockClear().mockResolvedValue({ response: 1, checkboxChecked: false });
  const { request, check, contents, createContents, dispose } = permissionHarness();
  const otherTab = createContents(8);
  const details = { requestingUrl: 'https://example.com/', isMainFrame: true };
  const query = (guest = contents, permission: Parameters<typeof check>[1] = 'notifications', url = details.requestingUrl, main = true) => check(guest, permission, url, { isMainFrame: main });
  try {
    expect(query()).toBe(false);
    const answer = vi.fn((allowed) => ({ allowed, checked: query() }));
    request(contents, 'notifications', answer, details);
    await Promise.resolve();
    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.results[0].value).toEqual({ allowed: true, checked: true });
    expect(query()).toBe(true);
    expect(query(otherTab)).toBe(false);
    expect(query(contents, 'geolocation')).toBe(false);
    expect(query(contents, 'notifications', 'https://other.example/')).toBe(false);
    expect(query(contents, 'notifications', details.requestingUrl, false)).toBe(false);
    request(contents, 'notifications', answer, details);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(dialog.showMessageBox).toHaveBeenCalledOnce();
    contents.emit('did-start-navigation', {}, 'https://example.com/#section', true, true);
    contents.emit('did-start-navigation', {}, 'https://example.com/frame', false, false);
    expect(query()).toBe(true);
    contents.emit('did-start-navigation', {}, details.requestingUrl, false, true);
    expect(query()).toBe(false);
  } finally { dispose(); }
});

it.each(['navigation', 'destroyed', 'render-process-gone', 'policy', 'dispose'] as const)(
  'invalidates pending and granted permissions on %s, including late prompt responses', async (reason) => {
    const { contents, request, check, update, dispose } = permissionHarness();
    const details = { requestingUrl: 'https://example.com/', isMainFrame: true };
    let resolve!: (answer: { response: number; checkboxChecked: boolean }) => void;
    vi.mocked(dialog.showMessageBox).mockImplementation(() => new Promise((done) => { resolve = done; }) as never);
    try {
      const first = vi.fn();
      request(contents, 'notifications', first, details);
      resolve({ response: 1, checkboxChecked: false });
      await Promise.resolve();
      expect(first).toHaveBeenCalledWith(true);
      expect(check(contents, 'notifications', details.requestingUrl, details)).toBe(true);
      update({ homeUrl: 'https://example.com/home' });
      expect(check(contents, 'notifications', details.requestingUrl, details)).toBe(true);

      const pending = vi.fn();
      request(contents, 'geolocation', pending, details);
      if (reason === 'navigation') contents.emit('did-start-navigation', {}, details.requestingUrl, false, true);
      else if (reason === 'policy') {
        update({ sitePermissions: { 'https://example.com': { notifications: 'block', geolocation: 'block' } } });
        update({ sitePermissions: {} });
      } else if (reason === 'dispose') dispose();
      else contents.emit(reason);
      resolve({ response: 1, checkboxChecked: false });
      await Promise.resolve();
      expect(pending.mock.calls).toEqual([[false]]);
      expect(check(contents, 'notifications', details.requestingUrl, details)).toBe(false);
      expect(check(contents, 'geolocation', details.requestingUrl, details)).toBe(false);
      expect(contents.listenerCount('did-start-navigation')).toBe(0);
      expect(contents.listenerCount('destroyed')).toBe(0);
      expect(contents.listenerCount('render-process-gone')).toBe(0);
    } finally { dispose(); }
  },
);

function permissionHarness() {
  const setRequest = vi.fn(); const setCheck = vi.fn();
  const session = { setPermissionRequestHandler: setRequest, setPermissionCheckHandler: setCheck } as unknown as Session;
  const owner = { isDestroyed: () => false } as BrowserWindow;
  const createContents = (id: number) => Object.assign(new EventEmitter(), {
    id, session, isDestroyed: () => false, getURL: () => 'https://example.com/',
  }) as unknown as WebContents;
  let value = patchBrowserPreferences(DEFAULT_BROWSER_PREFERENCES, { permissions: { notifications: 'ask', geolocation: 'ask' } });
  const listeners = new Set<Parameters<BrowserPreferencesStore['subscribe']>[0]>();
  const preferences = {
    get: () => value,
    subscribe: (listener: Parameters<BrowserPreferencesStore['subscribe']>[0]) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  } as BrowserPreferencesStore;
  const dispose = installBrowserPermissions(session, preferences, () => owner, () => 'en-US');
  return {
    contents: createContents(7), createContents, dispose,
    request: setRequest.mock.calls[0][0] as NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>,
    check: setCheck.mock.calls[0][0] as NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>,
    update(patch: BrowserPreferencesPatch) {
      value = patchBrowserPreferences(value, patch);
      for (const listener of listeners) listener(value);
    },
  };
}
