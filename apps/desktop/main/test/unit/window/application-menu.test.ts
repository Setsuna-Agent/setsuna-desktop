import { EventEmitter } from 'node:events';
import type { BrowserWindow, MenuItemConstructorOptions, PopupOptions } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';

const nativeMenu = vi.hoisted(() => ({ build: vi.fn(), popup: vi.fn() }));
vi.mock('electron', () => ({ Menu: { buildFromTemplate: nativeMenu.build } }));
import { showApplicationMenu } from '../../../src/window/application-menu.js';

beforeEach(() => {
  vi.clearAllMocks();
  nativeMenu.build.mockReturnValue({ popup: nativeMenu.popup });
});

function windowFixture() {
  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { getZoomFactor: () => 1 },
  }) as unknown as BrowserWindow;
}

it('rejects non-editing native roles and malformed requests before opening a menu', async () => {
  const window = windowFixture();
  for (const input of [
    null,
    { x: 0, y: 0, items: [{ type: 'edit', role: 'quit', label: 'Exit' }] },
    { x: 0, y: NaN, items: [{ type: 'edit', role: 'copy', label: 'Copy' }] },
    { x: 0, y: 0, items: [{ type: 'command', id: 'app.newChat', label: 'New' }] },
  ]) {
    await expect(showApplicationMenu(window, input)).resolves.toBeNull();
  }
  expect(nativeMenu.build).not.toHaveBeenCalled();
});

it('returns the selected app command and keeps native editing in the role allowlist', async () => {
  const window = windowFixture();
  const result = showApplicationMenu(window, { x: 0, y: 0, items: [
    { type: 'edit', role: 'copy', label: 'Copy' },
    { type: 'command', id: 'chat.find', label: 'Find', enabled: false },
    { type: 'command', id: 'app.newChat', label: 'New', enabled: true },
  ] });
  const template = nativeMenu.build.mock.calls[0][0] as MenuItemConstructorOptions[];
  expect(template[0].role).toBe('copy');
  expect(template[1].enabled).toBe(false);
  template[2].click?.({} as never, window, {} as never);
  (nativeMenu.popup.mock.calls[0][0] as PopupOptions).callback?.();
  await expect(result).resolves.toBe('app.newChat');
  expect(window.listenerCount('closed')).toBe(0);
});

it('resolves without a command when dismissed or its window closes', async () => {
  const input = { x: 0, y: 0, items: [{ type: 'edit', role: 'undo', label: 'Undo' }] };
  const window = windowFixture();
  const dismissed = showApplicationMenu(window, input);
  (nativeMenu.popup.mock.calls[0][0] as PopupOptions).callback?.();
  await expect(dismissed).resolves.toBeNull();
  const closed = showApplicationMenu(window, input);
  window.emit('closed');
  await expect(closed).resolves.toBeNull();
  expect(window.listenerCount('closed')).toBe(0);
});
