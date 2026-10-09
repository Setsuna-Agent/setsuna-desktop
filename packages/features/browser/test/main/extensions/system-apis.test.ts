import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { BrowserWindow, ContextMenuParams, Extension, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionSystemEvent } from '../../../src/contracts/extension-api.js';
import type { ExtensionContexts, ExtensionEndpoint } from '../../../src/main/extensions/contexts.js';
import { BrowserExtensionSystemApis } from '../../../src/main/extensions/system-apis.js';
import { encodeNativeMessage } from '../../../src/main/extensions/native-messaging/framing.js';

type ContextOptions = ConstructorParameters<typeof ExtensionContexts<ExtensionSystemEvent>>[0];
const transport = vi.hoisted(() => ({ call: null as ContextOptions['call'] | null, endpoints: vi.fn(), endpoint: vi.fn() }));
const native = vi.hoisted(() => ({ spawn: vi.fn(), resolve: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: native.spawn }));
vi.mock('../../../src/main/extensions/native-messaging/manifest.js', () => ({ resolveNativeHost: native.resolve }));
vi.mock('electron', () => ({ ipcMain: {}, webContents: {}, nativeImage: {}, shell: {} }));
vi.mock('../../../src/main/extensions/contexts.js', () => ({ ExtensionContexts: class {
  constructor(options: ContextOptions) { transport.call = options.call; }
  endpoints = transport.endpoints;
  endpoint = transport.endpoint;
  dispose() {}
} }));
afterEach(() => vi.clearAllMocks());

function createSystem(resolve: () => Extension) {
  const options = { session: Object.assign(new EventEmitter(), { cookies: new EventEmitter() }),
    resolve, owner: () => ({ id: 1 } as BrowserWindow), ownsGuest: () => true,
    windows: () => [], activate: vi.fn(), executeScript: vi.fn(), permissions: {}, activeTabs: {}, favicons: {} };
  return new BrowserExtensionSystemApis(options as unknown as ConstructorParameters<typeof BrowserExtensionSystemApis>[0]);
}

it.each(['navigationCommitted', 'navigationTargetCreated'] as const)(
  'drops %s when optional webNavigation is revoked while its worker starts', async kind => {
    let extension = { id: 'a'.repeat(32), manifest: { permissions: ['webNavigation'], optional_permissions: ['webNavigation'] } } as Extension;
    const system = createSystem(() => extension);
    const send = vi.fn();
    const endpoint = { key: 'worker', send, hold: () => () => {} } satisfies ExtensionEndpoint<ExtensionSystemEvent>;
    let resume!: (endpoints: ExtensionEndpoint<ExtensionSystemEvent>[]) => void;
    const starting = new Promise<ExtensionEndpoint<ExtensionSystemEvent>[]>(done => { resume = done; });
    transport.endpoints.mockReturnValueOnce(starting);
    const event = { kind, details: { tabId: 10, url: 'https://private.test/after-revocation', frameId: 0 } };
    try {
      system.publish(extension.id, event);
      extension = { ...extension, manifest: { ...extension.manifest, permissions: [] } };
      resume([endpoint]); await starting;
      expect(send).not.toHaveBeenCalled();

      extension = { ...extension, manifest: { ...extension.manifest, permissions: ['webNavigation'] } };
      transport.endpoints.mockResolvedValueOnce([endpoint]);
      system.publish(extension.id, event); await Promise.resolve();
      expect(send).toHaveBeenCalledExactlyOnceWith(event);
    } finally { system.dispose(); }
  },
);

it('clears revoked menus before replying, rejects captured clicks and rechecks permission after worker startup', async () => {
  let extension = { id: 'a'.repeat(32), manifest: { permissions: ['contextMenus'] } } as Extension;
  const system = createSystem(() => extension);
  const contents = { id: 10, isDestroyed: () => false, isFocused: () => true, session: { isPersistent: () => true },
    getURL: () => 'https://private.test/', getTitle: () => 'Private' } as unknown as WebContents;
  const params = { pageURL: contents.getURL(), frameURL: contents.getURL(), selectionText: 'private selection',
    linkURL: '', srcURL: '', mediaType: 'none', isEditable: false } as ContextMenuParams;
  const send = vi.fn();
  const endpoint = { key: 'worker', send, hold: () => () => {} } satisfies ExtensionEndpoint<ExtensionSystemEvent>;
  transport.endpoints.mockResolvedValue([endpoint]);
  try {
    await transport.call!(extension, 'worker', 'contextMenus.create', [{ id: 'private', title: 'Ask', contexts: ['selection'] }]);
    const [captured] = system.contextMenuItems(contents, params);
    captured.click!();
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'contextMenuClicked',
      info: expect.objectContaining({ pageUrl: contents.getURL(), selectionText: 'private selection' }) }));
    send.mockClear();

    let resume!: (endpoints: ExtensionEndpoint<ExtensionSystemEvent>[]) => void;
    const starting = new Promise<ExtensionEndpoint<ExtensionSystemEvent>[]>(done => { resume = done; });
    transport.endpoints.mockReturnValueOnce(starting);
    captured.click!();
    extension = { ...extension, manifest: { permissions: [] } };
    system.publish(extension.id, { kind: 'permissionsRemoved', permissions: { permissions: ['contextMenus'], origins: [] } });
    expect(system.contextMenuItems(contents, params)).toEqual([]);
    resume([endpoint]);
    await starting;
    await Promise.resolve();
    expect(send.mock.calls.map(([event]) => event.kind)).toEqual(['permissionsRemoved']);

    extension = { ...extension, manifest: { permissions: ['contextMenus'] } };
    expect(system.contextMenuItems(contents, params)).toEqual([]);
    send.mockClear();
    captured.click!();
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    await transport.call!(extension, 'worker', 'contextMenus.create', [{ id: 'private', title: 'New', contexts: ['selection'] }]);
    captured.click!();
    expect(send).not.toHaveBeenCalled();
    system.contextMenuItems(contents, params)[0].click!();
    await Promise.resolve();
    expect(send).toHaveBeenCalledOnce();
  } finally { system.dispose(); }
});

it('revokes native hosts and worker holds synchronously, including connections still resolving their registrations', async () => {
  let extension = { id: 'a'.repeat(32), manifest: { permissions: ['nativeMessaging'] } } as Extension;
  const system = createSystem(() => extension);
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  const releases = [vi.fn(), vi.fn()];
  const context = { key: 'worker', send: vi.fn(), hold: vi.fn().mockReturnValueOnce(releases[0]).mockReturnValueOnce(releases[1]) };
  transport.endpoint.mockReturnValue(context);
  transport.endpoints.mockReturnValue(new Promise(() => {}));
  native.spawn.mockReturnValue(child);
  native.resolve.mockResolvedValueOnce({ executable: '/registered/host', origin: `chrome-extension://${extension.id}/` });
  try {
    await transport.call!(extension, context.key, 'nativeMessaging.connect', ['active', 'org.fixture']);
    child.stdout.emit('data', encodeNativeMessage({ before: true }));
    expect(context.send).toHaveBeenCalledWith({ kind: 'nativeMessage', portId: 'active', message: { before: true } });

    let finish!: (host: { executable: string; origin: string }) => void;
    native.resolve.mockReturnValueOnce(new Promise(done => { finish = done; }));
    const opening = transport.call!(extension, context.key, 'nativeMessaging.connect', ['pending', 'org.fixture']);
    extension = { ...extension, manifest: { permissions: [] } };
    system.publish(extension.id, { kind: 'permissionsRemoved', permissions: { permissions: ['nativeMessaging'], origins: [] } });
    // Revocation cleanup must finish even if delivering onRemoved is waiting for a worker.
    expect(child.kill).toHaveBeenCalledOnce();
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
    expect(context.send.mock.calls.filter(([event]) => event.kind === 'nativeDisconnect').map(([event]) => event.portId))
      .toEqual(['active', 'pending']);
    context.send.mockClear();
    child.stdout.emit('data', encodeNativeMessage({ after: true }));
    finish({ executable: '/registered/host', origin: `chrome-extension://${extension.id}/` });
    await opening;
    expect(native.spawn).toHaveBeenCalledOnce();
    expect(context.send).not.toHaveBeenCalled();
    await expect(transport.call!(extension, context.key, 'nativeMessaging.connect', ['new', 'org.fixture'])).rejects.toThrow('permission required');
  } finally { system.dispose(); }
});
