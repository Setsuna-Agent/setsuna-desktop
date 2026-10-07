import { expect, it, vi } from 'vitest';
import { firstDeliveryResponse, UserScriptMessaging, type ScriptEndpoint } from '../../../../src/main/extensions/user-scripts/messaging.js';
import { PORT_CLOSED_ERROR, type WireAnswer } from '../../../../src/contracts/user-scripts.js';

it('returns the first responding frame even when another frame holds its channel open', async () => {
  let answerMain!: (answer: WireAnswer) => void;
  const main = new Promise<WireAnswer>((resolve) => { answerMain = resolve; });
  const child = { token: 2, responded: true, result: undefined };
  const result = firstDeliveryResponse([main, Promise.resolve(child)]);
  expect(await result).toEqual(child);
  answerMain({ token: 1, responded: true, result: 'late main response' });
  expect(await result).toEqual(child);
  expect(await firstDeliveryResponse([Promise.resolve({ token: 3, responded: true, result: 'main' }), new Promise(() => undefined)]))
    .toMatchObject({ responded: true, result: 'main' });
});

it('waits for all unsuccessful frames and preserves whether any listener handled the message', async () => {
  let finish!: (answer: WireAnswer | null) => void;
  const pending = new Promise<WireAnswer | null>((resolve) => { finish = resolve; });
  const result = firstDeliveryResponse([Promise.resolve({ token: 1, handled: true, responded: false }), pending]);
  const settled = vi.fn(); void result.then(settled);
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  finish(null);
  expect(await result).toEqual({ handled: true, responded: false });
  expect(await firstDeliveryResponse([])).toEqual({ handled: false, responded: false });
});

it('authenticates responses, accepts the first answer and closes pending calls when their document leaves', async () => {
  const messaging = new UserScriptMessaging();
  const release = vi.fn();
  const endpoint = { key: 'worker', send: vi.fn(), hold: () => release };
  const pending = messaging.message('extension', 'document', [endpoint], 'question', {});
  const token = endpoint.send.mock.calls[0][0].token;
  messaging.answer('other-extension', endpoint.key, { token, responded: true, result: 'forged' });
  messaging.answer('extension', 'other-worker', { token, responded: true, result: 'forged' });
  messaging.answer('extension', endpoint.key, { token, responded: true, result: 'valid' });
  expect(await pending).toEqual({ result: 'valid' });
  expect(release).toHaveBeenCalledOnce();
  const closed = messaging.message('extension', 'next-document', [endpoint], 'question', {});
  messaging.forgetDocument('next-document');
  expect(await closed).toEqual({ error: PORT_CLOSED_ERROR });
  expect(release).toHaveBeenCalledTimes(2);
  messaging.dispose();
});

it('buffers while the worker wakes, rejects other contexts and releases its worker on navigation', async () => {
  const messaging = new UserScriptMessaging();
  const release = vi.fn();
  const send = vi.fn();
  const endpoint: ScriptEndpoint = { key: 'worker', send, hold: () => release };
  const document = { key: 'document', send: vi.fn() };
  let wake: (endpoints: ScriptEndpoint[]) => void = () => undefined;
  const waking = new Promise<ScriptEndpoint[]>((resolve) => { wake = resolve; });
  messaging.connect('extension', document, 'page-port', waking, 'test', {});
  messaging.fromDocument(document.key, { kind: 'message', portId: 'page-port', message: 'queued' });
  wake([endpoint]); await waking;
  const portId = send.mock.calls[0][0].portId;
  messaging.fromExtension('other-extension', endpoint.key, { kind: 'accept', portId });
  expect(send).toHaveBeenCalledTimes(1);
  messaging.fromExtension('extension', endpoint.key, { kind: 'accept', portId });
  expect(send).toHaveBeenLastCalledWith({ kind: 'message', portId, message: 'queued' });
  messaging.fromExtension('extension', endpoint.key, { kind: 'message', portId, message: 'reply' });
  expect(document.send).toHaveBeenLastCalledWith({ kind: 'message', portId: 'page-port', message: 'reply' });
  messaging.forgetDocument(document.key);
  expect(send).toHaveBeenLastCalledWith({ kind: 'disconnect', portId });
  expect(release).toHaveBeenCalledOnce();
  messaging.dispose();
});

it('delivers every message in order to independently accepting contexts and cleans up rejected receivers', async () => {
  const messaging = new UserScriptMessaging();
  const document = { key: 'document', send: vi.fn() };
  const workerRelease = vi.fn(); const pageRelease = vi.fn();
  const worker = { key: 'worker', send: vi.fn(), hold: () => workerRelease };
  const page = { key: 'page', send: vi.fn(), hold: () => pageRelease };
  const rejected = { key: 'rejected', send: vi.fn() };
  let wake: (endpoints: ScriptEndpoint[]) => void = () => undefined;
  const waking = new Promise<ScriptEndpoint[]>((resolve) => { wake = resolve; });
  messaging.connect('extension', document, 'port', waking, 'test', {});
  const post = (message: string) => messaging.fromDocument(document.key, { kind: 'message', portId: 'port', message });
  post('before-discovery');
  wake([worker, page, rejected]); await waking;
  const portId = worker.send.mock.calls[0][0].portId;
  post('before-accept');
  messaging.fromExtension('extension', worker.key, { kind: 'accept', portId });
  post('after-first-accept');
  messaging.fromExtension('other-extension', page.key, { kind: 'accept', portId });
  messaging.fromExtension('extension', 'unknown-context', { kind: 'accept', portId });
  expect(page.send.mock.calls.map(([event]) => event.kind)).toEqual(['connect']);
  messaging.fromExtension('extension', rejected.key, { kind: 'disconnect', portId });
  messaging.fromExtension('extension', page.key, { kind: 'accept', portId });
  // Duplicate accepts must not replay either context's buffer.
  messaging.fromExtension('extension', page.key, { kind: 'accept', portId });
  post('after-both-accept');
  for (const endpoint of [worker, page]) {
    expect(endpoint.send.mock.calls.filter(([event]) => event.kind === 'message').map(([event]) => event.message))
      .toEqual(['before-discovery', 'before-accept', 'after-first-accept', 'after-both-accept']);
  }
  expect(rejected.send).toHaveBeenCalledOnce();
  messaging.forgetEndpoint(worker.key);
  expect(workerRelease).toHaveBeenCalledOnce();
  expect(document.send).not.toHaveBeenCalled();
  post('after-worker-closes');
  expect(page.send).toHaveBeenLastCalledWith({ kind: 'message', portId, message: 'after-worker-closes' });
  messaging.forgetDocument(document.key);
  expect(document.send).toHaveBeenCalledOnce();
  expect(pageRelease).toHaveBeenCalledOnce();
  expect(workerRelease).toHaveBeenCalledOnce();
  messaging.dispose();
});

it('bounds a slow receiver queue and disconnects both accepted and pending contexts on overflow', () => {
  const messaging = new UserScriptMessaging();
  const document = { key: 'document', send: vi.fn() };
  const release = vi.fn();
  const worker = { key: 'worker', send: vi.fn(), hold: () => release };
  const page = { key: 'page', send: vi.fn() };
  messaging.connect('extension', document, 'port', [worker, page], 'test', {});
  const portId = worker.send.mock.calls[0][0].portId;
  messaging.fromExtension('extension', worker.key, { kind: 'accept', portId });
  for (let index = 0; index <= 100; index++) messaging.fromDocument(document.key, { kind: 'message', portId: 'port', message: index });
  expect(document.send).toHaveBeenCalledWith({ kind: 'disconnect', portId: 'port', error: PORT_CLOSED_ERROR });
  expect(page.send).toHaveBeenLastCalledWith({ kind: 'disconnect', portId });
  expect(worker.send).toHaveBeenLastCalledWith({ kind: 'disconnect', portId });
  expect(release).toHaveBeenCalledOnce();
  messaging.dispose();
});
