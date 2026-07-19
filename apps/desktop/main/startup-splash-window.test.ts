import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStartupSplashWindowActionUrl,
  decodeStartupSplashPageUrl,
} from './startup-splash-page.js';
import { showStartupSplash, waitForRendererFirstPaint } from './startup-splash-window.js';

describe('startup splash window', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a splash content layer over the provided final window until disposal', async () => {
    const windowEvents = new EventEmitter();
    const addChildView = vi.fn();
    const removeChildView = vi.fn();
    const show = vi.fn();
    const loadURL = vi.fn().mockResolvedValue(undefined);
    const executeJavaScript = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const setBounds = vi.fn();
    const setBackgroundColor = vi.fn();
    const window = Object.assign(windowEvents, {
      contentView: { addChildView, removeChildView },
      getContentSize: () => [1320, 860],
      isDestroyed: () => false,
      show,
    }) as unknown as BrowserWindow;
    const view = {
      setBackgroundColor,
      setBounds,
      webContents: {
        close,
        executeJavaScript,
        isDestroyed: () => false,
        loadURL,
      },
    } as unknown as WebContentsView;

    const layer = await showStartupSplash(window, view);

    expect(addChildView).toHaveBeenCalledWith(view);
    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1320, height: 860 });
    expect(decodeStartupSplashPageUrl(String(loadURL.mock.calls[0]?.[0]))).toContain('setsuna-logo-shimmer');
    expect(show).toHaveBeenCalledOnce();
    expect(String(executeJavaScript.mock.calls[0]?.[0])).toContain("classList.add('startup-splash-running')");
    expect(show.mock.invocationCallOrder[0]).toBeLessThan(executeJavaScript.mock.invocationCallOrder[0]!);
    expect(removeChildView).not.toHaveBeenCalled();

    layer.dispose();
    expect(removeChildView).toHaveBeenCalledWith(view);
    expect(close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  });

  it('shows a window after restoring its maximized state', async () => {
    const windowEvents = new EventEmitter();
    const maximize = vi.fn();
    const show = vi.fn();
    const window = Object.assign(windowEvents, {
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      getContentSize: () => [1320, 860],
      isDestroyed: () => false,
      maximize,
      show,
    }) as unknown as BrowserWindow;
    const view = {
      setBackgroundColor: vi.fn(),
      setBounds: vi.fn(),
      webContents: {
        close: vi.fn(),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        isDestroyed: () => false,
        loadURL: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as WebContentsView;

    await showStartupSplash(window, view, undefined, { maximized: true });

    expect(maximize).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
    expect(maximize.mock.invocationCallOrder[0]).toBeLessThan(show.mock.invocationCallOrder[0]!);
  });

  it('routes splash titlebar controls to the existing BrowserWindow', async () => {
    let maximized = false;
    const windowEvents = new EventEmitter();
    const minimize = vi.fn();
    const maximize = vi.fn(() => { maximized = true; });
    const unmaximize = vi.fn(() => { maximized = false; });
    const closeWindow = vi.fn();
    const window = Object.assign(windowEvents, {
      close: closeWindow,
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      getContentSize: () => [1320, 860],
      isDestroyed: () => false,
      isMaximized: () => maximized,
      maximize,
      minimize,
      show: vi.fn(),
      unmaximize,
    }) as unknown as BrowserWindow;
    const webContents = Object.assign(new EventEmitter(), {
      close: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      isDestroyed: () => false,
      loadURL: vi.fn().mockResolvedValue(undefined),
    });
    const view = {
      setBackgroundColor: vi.fn(),
      setBounds: vi.fn(),
      webContents,
    } as unknown as WebContentsView;

    const layer = await showStartupSplash(window, view, undefined, { windowControls: true });
    const preventDefault = vi.fn();
    for (const action of ['minimize', 'toggle-maximize', 'close'] as const) {
      webContents.emit('will-navigate', {
        preventDefault,
        url: createStartupSplashWindowActionUrl(action),
      });
    }

    expect(preventDefault).toHaveBeenCalledTimes(3);
    expect(minimize).toHaveBeenCalledOnce();
    expect(maximize).toHaveBeenCalledOnce();
    expect(unmaximize).not.toHaveBeenCalled();
    expect(closeWindow).toHaveBeenCalledOnce();
    layer.dispose();
  });

  it('reveals the painted renderer before tearing down the splash surface', async () => {
    vi.useFakeTimers();
    const windowEvents = new EventEmitter();
    const removeChildView = vi.fn();
    const window = Object.assign(windowEvents, {
      contentView: { addChildView: vi.fn(), removeChildView },
      getContentSize: () => [1320, 860],
      isDestroyed: () => false,
      show: vi.fn(),
    }) as unknown as BrowserWindow;
    const close = vi.fn();
    const setVisible = vi.fn();
    const view = {
      setBackgroundColor: vi.fn(),
      setBounds: vi.fn(),
      setVisible,
      webContents: {
        close,
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
        isDestroyed: () => false,
        loadURL: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as WebContentsView;

    const layer = await showStartupSplash(window, view);
    layer.reveal();

    expect(setVisible).toHaveBeenCalledWith(false);
    expect(removeChildView).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(removeChildView).toHaveBeenCalledWith(view);
    expect(close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  });

  it('waits for the final renderer paint probe before removing the layer', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue(undefined);
    const window = {
      isDestroyed: () => false,
      webContents: {
        executeJavaScript,
        isDestroyed: () => false,
      },
    } as unknown as BrowserWindow;

    await waitForRendererFirstPaint(window);

    expect(executeJavaScript).toHaveBeenCalledOnce();
    expect(String(executeJavaScript.mock.calls[0]?.[0])).toContain("document.querySelector('.app-shell')");
  });
});
