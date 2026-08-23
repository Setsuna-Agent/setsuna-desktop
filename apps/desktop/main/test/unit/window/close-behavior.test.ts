import type { BrowserWindow, Menu, MenuItemConstructorOptions, NativeImage, Tray } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopWindowCloseBehaviorController } from '../../../src/window/close-behavior.js';
import { DesktopWindowPreferencesStore } from '../../../src/window/preferences.js';
import { DesktopTrayController, revealDesktopWindow } from '../../../src/window/tray.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('desktop window close behavior', () => {
  it('persists an explicit tray preference and defaults malformed files to quit', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-window-preferences-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'window-preferences.json');
    const store = new DesktopWindowPreferencesStore(filePath);

    await writeFile(filePath, '{"version":1,"closeBehavior":"unsupported"}', 'utf8');
    await expect(store.load()).resolves.toBe('quit');

    await store.save('hide-to-tray');
    await expect(store.load()).resolves.toBe('hide-to-tray');
  });

  it('falls back to quit when a stored tray preference cannot create a tray icon', async () => {
    const preferences = {
      load: vi.fn(async () => 'hide-to-tray' as const),
      save: vi.fn(async () => undefined),
    };
    const tray = {
      setEnabled: vi.fn(() => { throw new Error('tray unavailable'); }),
    };
    const reportError = vi.fn();
    const controller = new DesktopWindowCloseBehaviorController(preferences, tray, reportError);

    await expect(controller.initialize()).resolves.toBe('quit');

    expect(preferences.save).toHaveBeenCalledWith('quit');
    expect(controller.shouldHideWindow(false)).toBe(false);
    expect(reportError).toHaveBeenCalledOnce();
  });

  it('enables hiding only after the tray preference has been selected', async () => {
    const preferences = {
      load: vi.fn(async () => 'quit' as const),
      save: vi.fn(async () => undefined),
    };
    const tray = { setEnabled: vi.fn() };
    const controller = new DesktopWindowCloseBehaviorController(preferences, tray);

    await controller.initialize();
    expect(controller.shouldHideWindow(false)).toBe(false);

    await controller.setCloseBehavior('hide-to-tray');
    expect(preferences.save).toHaveBeenCalledWith('hide-to-tray');
    expect(tray.setEnabled).toHaveBeenLastCalledWith(true);
    expect(controller.shouldHideWindow(false)).toBe(true);
    expect(controller.shouldHideWindow(true)).toBe(false);
  });

  it('builds localized tray actions and routes icon clicks to the existing window', () => {
    let locale: 'zh-CN' | 'en-US' = 'zh-CN';
    let clickHandler: (() => void) | undefined;
    let menuTemplate: MenuItemConstructorOptions[] = [];
    const tray = {
      destroy: vi.fn(),
      on: vi.fn((_event, callback) => { clickHandler = callback; }),
      removeListener: vi.fn(),
      setContextMenu: vi.fn(),
      setToolTip: vi.fn(),
    } as unknown as Tray;
    const onOpen = vi.fn();
    const onQuit = vi.fn();
    const controller = new DesktopTrayController({
      buildMenu: (template) => {
        menuTemplate = template;
        return {} as Menu;
      },
      createTray: () => tray,
      getInterfaceLanguage: () => locale,
      icon: { isEmpty: () => false } as NativeImage,
      onOpen,
      onQuit,
    });

    controller.setEnabled(true);
    expect(menuTemplate.map((item) => item.label ?? item.type)).toEqual([
      '打开 Setsuna Desktop',
      'separator',
      '退出',
    ]);

    clickHandler?.();
    invokeMenuItem(menuTemplate[0]);
    invokeMenuItem(menuTemplate[2]);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onQuit).toHaveBeenCalledOnce();

    locale = 'en-US';
    controller.refreshMenu();
    expect(menuTemplate[0]?.label).toBe('Open Setsuna Desktop');
  });

  it('restores a minimized window before showing and focusing it', () => {
    const window = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
    } as unknown as BrowserWindow;

    revealDesktopWindow(window);

    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });
});

function invokeMenuItem(item: MenuItemConstructorOptions | undefined): void {
  (item?.click as (() => void) | undefined)?.();
}
