// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebviewTag } from 'electron';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BROWSER_URL, type BrowserDesktopBridge } from '../../src/contracts/index.js';
import { BrowserPanel } from '../../src/renderer/BrowserPanel.js';
import {
  BROWSER_BOOKMARKS_STORAGE_KEY,
  readBrowserBookmarks,
} from '../../src/renderer/browserBookmarks.js';
import {
  BROWSER_HISTORY_STORAGE_KEY,
  readBrowserHistory,
  writeBrowserHistory,
} from '../../src/renderer/browserHistory.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';

const translate = (key: Parameters<typeof translateBrowserMessage>[1]) => (
  translateBrowserMessage('en-US', key)
);
let browserBridge = createBrowserBridge();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem(BROWSER_BOOKMARKS_STORAGE_KEY);
  window.localStorage.removeItem(BROWSER_HISTORY_STORAGE_KEY);
  browserBridge = createBrowserBridge();
});

describe('BrowserPanel interactions', () => {
  it('opens a recent page from the internal home', async () => {
    writeBrowserHistory([{
      title: 'Example documentation',
      url: 'https://example.com/docs',
      visitedAt: Date.now(),
    }]);
    renderBrowserPanel(DEFAULT_BROWSER_URL);

    expect(document.querySelector('webview')).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open Example documentation' }));

    expect(document.querySelector('webview')?.getAttribute('src')).toBe('https://example.com/docs');
  });

  it('deletes an individual recent visit without navigating', async () => {
    writeBrowserHistory([{
      title: 'Example documentation',
      url: 'https://example.com/docs',
      visitedAt: Date.now(),
    }]);
    renderBrowserPanel(DEFAULT_BROWSER_URL);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete recent visit Example documentation' }));

    expect(screen.queryByRole('button', { name: 'Open Example documentation' })).toBeNull();
    expect(readBrowserHistory()).toEqual([]);
    expect(document.querySelector('webview')).toBeNull();
  });

  it('toggles the current page bookmark and exposes it on the home page', async () => {
    renderBrowserPanel();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Bookmark current page' }));
    expect(readBrowserBookmarks()).toMatchObject([{
      title: 'New tab',
      url: 'https://example.com/',
    }]);

    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('button', { name: 'Open New tab' })).toBeTruthy();
  });

  it('records successful main-frame navigations with their page title', async () => {
    renderBrowserPanel();
    const webview = document.querySelector('webview') as unknown as WebviewTag;
    Object.assign(webview, {
      canGoBack: () => false,
      canGoForward: () => false,
      getURL: () => 'https://example.com/docs',
      getZoomFactor: () => 1,
    });

    webview.dispatchEvent(new Event('did-navigate'));
    webview.dispatchEvent(Object.assign(new Event('page-title-updated'), {
      title: 'Example documentation',
    }));

    await waitFor(() => expect(readBrowserHistory()[0]).toMatchObject({
      title: 'Example documentation',
      url: 'https://example.com/docs',
    }));
  });

  it('commits the requested zoom only after the webview accepts it', async () => {
    const setZoomFactor = vi.fn();
    renderBrowserPanel();
    installZoomMethods(setZoomFactor);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Zoom in' }));

    expect(setZoomFactor).toHaveBeenCalledWith(1.1);
    expect(screen.getByRole('menuitem', { name: 'Reset zoom' }).textContent).toBe('110%');
  });

  it('keeps the last confirmed zoom and reports a rejected webview action', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setZoomFactor = vi.fn(() => { throw new Error('detached'); });
    renderBrowserPanel();
    installZoomMethods(setZoomFactor);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Zoom in' }));

    expect(setZoomFactor).toHaveBeenCalledWith(1.1);
    expect(screen.getByRole('menuitem', { name: 'Reset zoom' }).textContent).toBe('100%');
    expect(screen.getByText('Could not change the current page zoom')).toBeTruthy();
  });

  it('defers device emulation warnings until the webview is registered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registerTab = vi.fn(async () => true);
    const setDeviceEmulation = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    installBrowserBridge({ registerTab, setDeviceEmulation });
    renderBrowserPanel();

    const webview = document.querySelector('webview') as unknown as WebviewTag;
    const loadURL = vi.fn(async () => undefined);
    const reload = vi.fn();
    Object.assign(webview, { loadURL, reload });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }));

    expect(screen.getByRole('toolbar', { name: 'Device toolbar' })).toBeTruthy();
    expect(setDeviceEmulation).not.toHaveBeenCalled();
    expect(screen.queryByText('Device emulation could not be applied; the page will keep its current settings')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reload page' }));
    await waitFor(() => expect(setDeviceEmulation).toHaveBeenCalledTimes(1));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Device emulation could not be applied; the page will keep its current settings')).toBeNull();

    const address = screen.getByRole('textbox', { name: 'Address or search' });
    await user.clear(address);
    await user.type(address, 'example.org/docs{Enter}');
    await waitFor(() => expect(setDeviceEmulation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadURL).toHaveBeenCalledWith('https://example.org/docs'));
    expect(screen.queryByText('Device emulation could not be applied; the page will keep its current settings')).toBeNull();

    Object.assign(webview, { getWebContentsId: () => 42 });
    webview.dispatchEvent(new Event('dom-ready'));

    await waitFor(() => expect(registerTab).toHaveBeenCalledWith('browser-interaction', 42));
    await waitFor(() => expect(setDeviceEmulation).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('Device emulation could not be applied; the page will keep its current settings')).toBeNull();
  });
});

function renderBrowserPanel(url = 'https://example.com') {
  return render(<BrowserPanelHarness url={url} />);
}

function BrowserPanelHarness({ url }: { url: string }) {
  const [notification, setNotification] = useState<string | null>(null);
  const notify = useCallback((_tone: string, message: string) => setNotification(message), []);
  return (
    <>
      <BrowserPanel
        bridge={browserBridge}
        hidden={false}
        notify={notify}
        panel={{
          browser: { faviconUrl: null, loading: false, url },
          id: 'browser-interaction',
          title: 'New tab',
        }}
        translate={translate}
        onPanelMetadataChange={() => undefined}
      />
      {notification ? <span>{notification}</span> : null}
    </>
  );
}

function installZoomMethods(setZoomFactor: (value: number) => void): WebviewTag {
  const webview = document.querySelector('webview') as unknown as WebviewTag;
  Object.assign(webview, {
    getZoomFactor: () => 1,
    setZoomFactor,
  });
  return webview;
}

function installBrowserBridge({
  registerTab,
  setDeviceEmulation,
}: {
  registerTab: (tabId: string, webContentsId: number) => Promise<boolean>;
  setDeviceEmulation: (tabId: string, deviceEmulation: unknown) => Promise<boolean>;
}): void {
  browserBridge = createBrowserBridge({ registerTab, setDeviceEmulation });
}

function createBrowserBridge(overrides: Partial<BrowserDesktopBridge> = {}): BrowserDesktopBridge {
  return {
    captureScreenshot: vi.fn(async () => null),
    onOpenNewTab: vi.fn(() => () => undefined),
    registerTab: vi.fn(async () => false),
    resolveFavicon: vi.fn(async () => null),
    setActiveTab: vi.fn(async () => true),
    setDeviceEmulation: vi.fn(async () => true),
    unregisterTab: vi.fn(async () => true),
    ...overrides,
  };
}
