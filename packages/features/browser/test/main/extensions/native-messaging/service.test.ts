import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Extension } from 'electron';
import { expect, it, vi } from 'vitest';
import { BrowserExtensionNativeMessaging } from '../../../../src/main/extensions/native-messaging/service.js';
import { encodeNativeMessage } from '../../../../src/main/extensions/native-messaging/framing.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), resolve: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../../../../src/main/extensions/native-messaging/manifest.js', () => ({ resolveNativeHost: mocks.resolve }));
const extension = (id: string, permissions = ['nativeMessaging']) => ({ id, manifest: { permissions } }) as Extension;
const child = () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() }) as unknown as ChildProcessWithoutNullStreams;

it('routes framed messages to the owning context and releases the worker when its port closes', async () => {
  const process = child(); mocks.spawn.mockReturnValue(process);
  mocks.resolve.mockResolvedValue({ executable: '/registered/host', origin: `chrome-extension://${'a'.repeat(32)}/` });
  const release = vi.fn(); const context = { key: 'worker:1', send: vi.fn(), hold: vi.fn(() => release) };
  const service = new BrowserExtensionNativeMessaging(); const owner = extension('a'.repeat(32));
  await service.call(owner, context, 'connect', ['port', 'org.fixture']);
  expect(mocks.spawn).toHaveBeenLastCalledWith('/registered/host', expect.arrayContaining([`chrome-extension://${owner.id}/`]), expect.objectContaining({ shell: false }));
  await service.call(owner, context, 'postMessage', ['port', { id: 1, text: '你好' }]);
  expect(process.stdin.read()).toEqual(encodeNativeMessage({ id: 1, text: '你好' }));
  const response = encodeNativeMessage({ id: 1, result: 'ready' });
  process.stdout.emit('data', response.subarray(0, 5)); process.stdout.emit('data', response.subarray(5));
  expect(context.send).toHaveBeenCalledWith({ kind: 'nativeMessage', portId: 'port', message: { id: 1, result: 'ready' } });
  await expect(service.call(extension('b'.repeat(32)), context, 'postMessage', ['port', {}])).rejects.toThrow('disconnected');
  await expect(service.call(owner, { ...context, key: 'frame:2' }, 'postMessage', ['port', {}])).rejects.toThrow('disconnected');
  service.closeContext(context.key); process.emit('exit', 0);
  expect(process.kill).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
  expect(context.send).toHaveBeenCalledWith({ kind: 'nativeDisconnect', portId: 'port' });
  service.dispose();
});

it('checks permission before starting a host and cancels pending connects on context destruction', async () => {
  const service = new BrowserExtensionNativeMessaging(); const release = vi.fn();
  const context = { key: 'worker:2', send: vi.fn(), hold: () => release };
  await expect(service.call(extension('a', []), context, 'connect', ['port', 'org.fixture'])).rejects.toThrow('permission');
  expect(release).not.toHaveBeenCalled();
  let resolve!: (host: { executable: string; origin: string }) => void;
  mocks.resolve.mockReturnValue(new Promise((done) => { resolve = done; }));
  mocks.spawn.mockClear();
  const opening = service.call(extension('a'), context, 'connect', ['port', 'org.fixture']);
  service.closeContext(context.key); resolve({ executable: '/registered/host', origin: 'chrome-extension://a/' });
  await opening;
  expect(mocks.spawn).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(1);
  service.dispose();
});
