import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { SandboxDialogSessions, type ShowSandboxDialog } from '../../../src/runtime/sandbox-dialog-sessions.js';

it('accepts only valid dialog requests and scopes revocation to the owning window', async () => {
  const show = vi.fn<ShowSandboxDialog>().mockResolvedValue(false);
  const sessions = new SandboxDialogSessions(show);
  const owner = windowFixture(1);
  const id = sessions.register(owner, 'Table');
  const request = { kind: 'confirm', message: 'Delete row?' };
  const signal = new AbortController().signal;
  for (const input of [null, { ...request, kind: 'runtime-request' }, { ...request, message: 'x'.repeat(16_385) }, { ...request, defaultValue: {} }]) {
    await expect(sessions.request(id, input, signal)).rejects.toThrow();
  }
  await expect(sessions.request('guessed', request, signal)).rejects.toThrow('unavailable');
  expect(show).not.toHaveBeenCalled();
  sessions.release(2, id);
  await expect(sessions.request(id, request, signal)).resolves.toBe(false);
  expect(show).toHaveBeenCalledWith(owner, request, { title: 'Table', signal: expect.any(AbortSignal) });
  sessions.release(1, id);
  await expect(sessions.request(id, request, signal)).rejects.toThrow('unavailable');
  expect(owner.listenerCount('closed')).toBe(0);
  expect(owner.webContents.listenerCount('render-process-gone')).toBe(0);
});

it.each(['release', 'closed', 'render-process-gone', 'disconnect'] as const)('cancels a pending dialog on %s and keeps other windows independent', async (scenario) => {
  const show = vi.fn<ShowSandboxDialog>().mockImplementation((_owner, _request, { signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(null), { once: true });
  }));
  const sessions = new SandboxDialogSessions(show);
  const owner = windowFixture(1);
  const other = windowFixture(2);
  const id = sessions.register(owner, 'One');
  const sibling = sessions.register(owner, 'Sibling');
  const otherId = sessions.register(other, 'Two');
  const input = { kind: 'prompt', message: 'Name', defaultValue: 'Old' };
  const controller = new AbortController();
  const first = sessions.request(id, input, controller.signal);
  const second = sessions.request(otherId, input, new AbortController().signal);
  await expect(sessions.request(sibling, input, new AbortController().signal)).rejects.toThrow('already open');
  expect(owner.listenerCount('closed')).toBe(1);
  if (scenario === 'release') sessions.release(1, id);
  else if (scenario === 'closed') owner.emit('closed');
  else if (scenario === 'render-process-gone') owner.webContents.emit('render-process-gone');
  else controller.abort();
  await expect(first).resolves.toBeNull();
  expect(show.mock.calls[1][2].signal.aborted).toBe(false);
  sessions.dispose();
  await expect(second).resolves.toBeNull();
  expect(owner.listenerCount('closed')).toBe(0);
  expect(other.listenerCount('closed')).toBe(0);
});

function windowFixture(id: number): BrowserWindow {
  return Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { id }), isDestroyed: () => false,
  }) as unknown as BrowserWindow;
}

it('updates only the owning session title without cancelling its active dialog', async () => {
  let finish!: (result: boolean) => void;
  const show = vi.fn<ShowSandboxDialog>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValue(false);
  const sessions = new SandboxDialogSessions(show);
  const owner = windowFixture(1);
  const id = sessions.register(owner, 'Table');
  const request = { kind: 'confirm', message: 'Delete row?' };
  const pending = sessions.request(id, request, new AbortController().signal);
  expect(() => sessions.updateTitle(2, id, 'Other window')).toThrow('unavailable');
  expect(() => sessions.updateTitle(1, id, 'x'.repeat(513))).toThrow('Invalid dialog title');
  sessions.updateTitle(1, id, 'Renamed table');
  expect(show.mock.calls[0][2].signal.aborted).toBe(false);
  finish(false);
  await pending;
  await sessions.request(id, request, new AbortController().signal);
  expect(show).toHaveBeenLastCalledWith(owner, request, { title: 'Renamed table', signal: expect.any(AbortSignal) });
  sessions.release(1, id);
  expect(() => sessions.updateTitle(1, id, 'Released')).toThrow('unavailable');
});
