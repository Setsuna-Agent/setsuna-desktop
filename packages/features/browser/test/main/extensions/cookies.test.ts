import { EventEmitter } from 'node:events';
import type { Cookie, Extension, Session } from 'electron';
import { expect, it, vi } from 'vitest';
import { BrowserExtensionCookies } from '../../../src/main/extensions/cookies.js';

function fixture() {
  const extension = { id: 'a'.repeat(32), path: '/extension', version: '1.0', manifest: {
    permissions: ['cookies'], host_permissions: ['https://allowed.test/*'],
  } } as unknown as Extension;
  const secret = { name: 'login', value: 'secret', domain: 'foreign.test', path: '/', secure: true, sameSite: 'strict', hostOnly: true } as Cookie;
  const visible = { ...secret, value: 'visible', domain: 'allowed.test' };
  let current: Extension | null = extension;
  const cookies = Object.assign(new EventEmitter(), {
    get: vi.fn(async (_input: unknown): Promise<Cookie[]> => [secret, visible]), set: vi.fn(async (_input: unknown) => undefined), remove: vi.fn(),
  });
  const session = { cookies, extensions: { getAllExtensions: () => [extension] } } as unknown as Session;
  const publish = vi.fn();
  const api = new BrowserExtensionCookies({ session, resolve: () => current, tabIds: () => [7], publish });
  return { api, extension, cookies, visible, secret, publish,
    revoke: () => { current = { ...extension, manifest: { ...extension.manifest, host_permissions: [] } }; } };
}

it('filters cookie values and events by declared hosts and rejects foreign stores or wider domain writes', async () => {
  const { api, extension, cookies, visible, secret, publish } = fixture();
  api.start();
  try {
    expect(await api.call(extension, 'getAll', [{}])).toEqual([expect.objectContaining({ value: 'visible', storeId: '0' })]);
    expect(await api.call(extension, 'getAll', [{ url: 'https://foreign.test/' }])).toEqual([]);
    await expect(api.call(extension, 'get', [{ name: 'login', url: 'https://foreign.test/' }])).rejects.toThrow('Host permission');
    await expect(api.call(extension, 'getAll', [{ storeId: 'desktop' }])).rejects.toThrow('Unknown cookie store');
    await expect(api.call(extension, 'getAll', [{ partitionKey: { topLevelSite: 'https://allowed.test' } }])).rejects.toThrow('Partitioned');
    await expect(api.call(extension, 'set', [{ url: 'https://allowed.test/', domain: '.test' }])).rejects.toThrow('Host permission');
    expect(cookies.set).not.toHaveBeenCalled();
    cookies.emit('changed', {}, secret, 'inserted', false);
    cookies.emit('changed', {}, visible, 'expired-overwrite', true);
    expect(publish).toHaveBeenCalledExactlyOnceWith(extension.id, { kind: 'cookieChanged', changeInfo: {
      removed: true, cause: 'expired_overwrite', cookie: expect.objectContaining({ value: 'visible', storeId: '0' }),
    } });
  } finally { api.dispose(); }
  cookies.emit('changed', {}, visible, 'inserted', false);
  expect(publish).toHaveBeenCalledOnce();
});

it('returns the longest matching path and removes only that canonical cookie instead of every same-name cookie', async () => {
  const { api, extension, cookies, visible } = fixture();
  const specific = { ...visible, path: '/account', value: 'specific' };
  cookies.get.mockResolvedValue([visible, specific]);
  expect(await api.call(extension, 'get', [{ url: 'https://allowed.test/account/settings', name: 'login' }])).toMatchObject({ path: '/account', value: 'specific' });
  expect(await api.call(extension, 'remove', [{ url: 'https://allowed.test/account/settings', name: 'login' }])).toEqual({
    url: 'https://allowed.test/account/settings', name: 'login', storeId: '0',
  });
  expect(cookies.remove).not.toHaveBeenCalled();
  expect(cookies.set).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: '/account', name: 'login', expirationDate: 1 }));
});

it('rechecks host access before delivering asynchronous cookie values', async () => {
  const { api, extension, cookies, visible, revoke } = fixture();
  cookies.get.mockImplementationOnce(async () => { revoke(); return [visible]; });
  expect(await api.call(extension, 'getAll', [{ url: 'https://allowed.test/' }])).toEqual([]);
});
