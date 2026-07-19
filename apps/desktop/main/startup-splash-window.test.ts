import { EventEmitter } from 'node:events';
import type { BrowserWindow, WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { decodeStartupSplashPageUrl } from './startup-splash-page.js';
import { showStartupSplash, waitForRendererFirstPaint } from './startup-splash-window.js';

describe('startup splash window', () => {
  it('keeps a splash content layer over the provided final window until disposal', async () => {
    const windowEvents = new EventEmitter();
    const addChildView = vi.fn();
    const removeChildView = vi.fn();
    const show = vi.fn();
    const loadURL = vi.fn().mockResolvedValue(undefined);
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
        isDestroyed: () => false,
        loadURL,
      },
    } as unknown as WebContentsView;

    const layer = await showStartupSplash(window, view);

    expect(addChildView).toHaveBeenCalledWith(view);
    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1320, height: 860 });
    expect(decodeStartupSplashPageUrl(String(loadURL.mock.calls[0]?.[0]))).toContain('setsuna-logo-shimmer');
    expect(show).toHaveBeenCalledOnce();
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
        isDestroyed: () => false,
        loadURL: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as WebContentsView;

    await showStartupSplash(window, view, undefined, { maximized: true });

    expect(maximize).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
    expect(maximize.mock.invocationCallOrder[0]).toBeLessThan(show.mock.invocationCallOrder[0]!);
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
    expect(String(executeJavaScript.mock.calls[0]?.[0])).toContain("document.getElementById('root')");
  });
});
