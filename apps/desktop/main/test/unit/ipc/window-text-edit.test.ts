import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({
  BrowserWindow: {},
  Menu: {},
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler); },
    removeHandler: (channel: string) => { handlers.delete(channel); },
  },
}));
import { registerWindowIpc } from '../../../src/ipc/window-ipc.js';
import { desktopWindows } from '../../../src/window/registry.js';

beforeEach(() => registerWindowIpc({ macTrafficLightPosition: () => ({ x: 0, y: 0 }) }));
afterEach(() => { for (const window of desktopWindows.all()) window.emit('closed'); });

function createSender(id: number) {
  return { id, mainFrame: {}, isDestroyed: vi.fn(() => false), cut: vi.fn(), copy: vi.fn(), paste: vi.fn() };
}
function register(sender: ReturnType<typeof createSender>) {
  desktopWindows.add(Object.assign(new EventEmitter(), {
    webContents: sender, isDestroyed: () => false,
  }) as unknown as BrowserWindow);
}

it('executes native clipboard commands only in the requesting desktop window', () => {
  const sender = createSender(1);
  const other = createSender(2);
  register(sender);
  register(other);
  const execute = handlers.get('window-control:execute-text-edit')!;
  for (const command of ['cut', 'copy', 'paste'] as const) {
    expect(execute({ sender, senderFrame: sender.mainFrame }, command)).toBe(true);
    expect(sender[command]).toHaveBeenCalledOnce();
    expect(other[command]).not.toHaveBeenCalled();
  }
});

it('rejects guests, child frames, destroyed senders and arbitrary webContents methods', () => {
  const sender = createSender(1);
  const guest = createSender(2);
  register(sender);
  const execute = handlers.get('window-control:execute-text-edit')!;
  expect(execute({ sender: guest, senderFrame: guest.mainFrame }, 'paste')).toBe(false);
  expect(execute({ sender, senderFrame: {} }, 'paste')).toBe(false);
  for (const command of ['executeJavaScript', 'delete', 'toString', null, { command: 'paste' }]) {
    expect(execute({ sender, senderFrame: sender.mainFrame }, command)).toBe(false);
  }
  sender.isDestroyed.mockReturnValue(true);
  expect(execute({ sender, senderFrame: sender.mainFrame }, 'paste')).toBe(false);
  for (const source of [sender, guest]) {
    for (const command of ['cut', 'copy', 'paste'] as const) expect(source[command]).not.toHaveBeenCalled();
  }
});
