import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import {
  isSupportedExternalUrl,
  isTrustedRendererNavigation,
  registerMainWindowNavigationGuards,
} from '../../../src/window/navigation.js';

describe('main window navigation guards', () => {
  it('keeps renderer navigation local and opens supported external links through the host', async () => {
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined;
    const mainFrame = {};
    let frameNavigate: ((event: {
      preventDefault(): void;
      initiator?: unknown;
      isMainFrame: boolean;
      url: string;
    }) => void) | undefined;
    let openWindow: ((details: { url: string }) => { action: 'deny' }) | undefined;
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const preventDefault = vi.fn();
    const webContents = {
      getURL: () => 'file:///app/dist/renderer/index.html',
      mainFrame,
      on: vi.fn((event: string, listener: unknown) => {
        if (event === 'will-navigate') navigate = listener as typeof navigate;
        if (event === 'will-frame-navigate') frameNavigate = listener as typeof frameNavigate;
      }),
      setWindowOpenHandler: vi.fn((handler: typeof openWindow) => {
        openWindow = handler;
      }),
    };

    registerMainWindowNavigationGuards(
      { webContents } as unknown as BrowserWindow,
      openExternal,
    );
    navigate?.({ preventDefault }, 'https://example.com/readme');
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/readme');
    expect(openWindow?.({ url: 'file:///tmp/unsafe.html' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledTimes(1);

    const preventFrameNavigation = vi.fn();
    frameNavigate?.({
      preventDefault: preventFrameNavigation,
      isMainFrame: false,
      url: 'https://example.com/leak?payload=secret',
    });
    expect(preventFrameNavigation).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledTimes(1);

    const preventChildTopNavigation = vi.fn();
    frameNavigate?.({
      preventDefault: preventChildTopNavigation,
      initiator: {},
      isMainFrame: true,
      url: 'https://example.com/leak-from-child',
    });
    expect(preventChildTopNavigation).toHaveBeenCalledOnce();
  });

  it('only allows reloads within the trusted renderer location', () => {
    expect(isTrustedRendererNavigation(
      'http://localhost:5173/index.html',
      'http://localhost:5173/index.html',
    )).toBe(true);
    expect(isTrustedRendererNavigation(
      'file:///app/dist/renderer/index.html',
      'file:///app/dist/renderer/other.html',
    )).toBe(false);
    expect(isSupportedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSupportedExternalUrl('mailto:user@example.com')).toBe(true);
  });
});
