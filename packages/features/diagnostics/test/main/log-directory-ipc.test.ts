import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openPath: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
  shell: { openPath: mocks.openPath },
}));
import { diagnosticsMainFeature, diagnosticsMainHostCapability } from '../../src/main/feature.js';
import { defineMainFeatureHost, type MainFeatureComposition } from '@setsuna-desktop/feature-core/main';
import { provideHostCapability } from '@setsuna-desktop/feature-core/capability';

let root: string;
let directory: string;
let composition: MainFeatureComposition | undefined;
beforeEach(async () => {
  composition = undefined;
  root = await mkdtemp(path.join(tmpdir(), 'setsuna-diagnostic-ipc-'));
  directory = path.join(root, 'logs');
  mocks.openPath.mockReset().mockResolvedValue('');
  mocks.handlers.clear();
  composition = await defineMainFeatureHost({ required: [], optional: [diagnosticsMainFeature] }).activate({
    hostCapabilities: [provideHostCapability(diagnosticsMainHostCapability, { directory, isAllowedSender: (id) => id === 1 })],
  });
});
afterEach(async () => {
  await composition?.dispose();
  await rm(root, { recursive: true, force: true });
});
const get = (event: unknown) => mocks.handlers.get('diagnostics:log-directory')!(event);
const open = (event: unknown, ...args: unknown[]) => mocks.handlers.get('diagnostics:open-log-directory')!(event, ...args);

function sender(registered = true) {
  const contents = { id: registered ? 1 : 2, mainFrame: {} };
  return { sender: contents, senderFrame: contents.mainFrame };
}

it('opens the main-owned directory even before the first crash and ignores supplied paths', async () => {
  const event = sender();
  expect(get(event)).toBe(directory);
  await expect(open(event, root)).resolves.toEqual({ ok: true });
  expect((await stat(directory)).isDirectory()).toBe(true);
  expect(mocks.openPath).toHaveBeenCalledExactlyOnceWith(directory);
});

it('rejects guests and child frames before exposing or creating the log directory', async () => {
  const event = sender();
  for (const untrusted of [sender(false), { ...event, senderFrame: {} }]) {
    expect(() => get(untrusted)).toThrow('Desktop renderer is unavailable.');
    await expect(open(untrusted)).resolves.toMatchObject({ ok: false });
  }
  expect(mocks.openPath).not.toHaveBeenCalled();
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('returns filesystem and OS open failures for the existing toast flow', async () => {
  const event = sender();
  mocks.openPath.mockResolvedValueOnce('No file manager');
  await expect(open(event)).resolves.toEqual({ ok: false, error: 'No file manager' });
  mocks.openPath.mockRejectedValueOnce(new Error('OS unavailable'));
  await expect(open(event)).resolves.toEqual({ ok: false, error: 'OS unavailable' });
  await rm(directory, { recursive: true });
  await writeFile(directory, 'blocked');
  await expect(open(event)).resolves.toMatchObject({ ok: false });
  expect(mocks.openPath).toHaveBeenCalledTimes(2);
});

it('registers the optional Feature without disk access and releases its handlers on disposal', async () => {
  expect(get(sender())).toBe(directory);
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  await composition!.dispose();
  expect(mocks.handlers.size).toBe(0);
});
