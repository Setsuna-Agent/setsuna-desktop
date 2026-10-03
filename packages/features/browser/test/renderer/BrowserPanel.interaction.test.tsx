// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebviewTag } from 'electron';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BROWSER_URL, parseBrowserAnnotationMessage, type BrowserAnnotationSendHandler,
  type BrowserAnnotationTarget, type BrowserContextMenuRequest, type BrowserDesktopBridge,
} from '../../src/contracts/index.js';
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
  it.each(['reload', 'navigation', 'in-page navigation', 'home'])('starts a fresh annotation batch after %s without capturing old node IDs', async (navigation) => {
    const target: BrowserAnnotationTarget = {
      id: '27f0b1c9-8c70-452e-8cce-2dd7e029f084', url: 'https://example.com/', title: 'Example',
      selector: '#submit', tag: 'button', text: 'Submit', bounds: { x: 1, y: 2, width: 30, height: 40 },
      viewport: { width: 800, height: 600 }, styles: {},
    };
    const next = { ...target, id: '69a247d0-0ea1-4d87-9d27-701e850138ee' };
    const pickAnnotation = vi.fn(async (): Promise<BrowserAnnotationTarget | null> => null).mockResolvedValueOnce(target);
    const captureAnnotationScreenshots = vi.fn(async (_tabId: string, ids: readonly string[]) => ids.includes(target.id) ? null : [{
      dataUrl: 'data:image/png;base64,b3JpZ2luYWw=', width: 1280, height: 720, mimeType: 'image/png' as const, size: 8,
    }]);
    const onSend = vi.fn<BrowserAnnotationSendHandler>(async () => true);
    browserBridge = createBrowserBridge({ pickAnnotation, captureAnnotationScreenshots });
    render(<BrowserPanelHarness url={target.url} onSendAnnotations={onSend} />);
    let webview = document.querySelector('webview') as unknown as WebviewTag;
    const attachNavigationMethods = () => Object.assign(webview, {
      getURL: () => next.url, getZoomFactor: () => 1, canGoBack: () => false, canGoForward: () => false,
    });
    attachNavigationMethods();
    fireEvent(webview, new Event('did-stop-loading'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Annotate page' }));
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Old page note');
    await user.click(screen.getByRole('button', { name: 'Save & continue' }));
    // Subframe navigation does not dispose the main document's annotation session.
    fireEvent(webview, Object.assign(new Event('did-start-navigation'), { isMainFrame: false, isInPlace: false }));
    await user.click(screen.getByRole('button', { name: 'Send to Agent' }));
    expect(captureAnnotationScreenshots).toHaveBeenLastCalledWith('browser-interaction', [target.id]);
    captureAnnotationScreenshots.mockClear();

    if (navigation === 'home') {
      await user.click(screen.getByRole('button', { name: 'Home' }));
      await user.type(screen.getByRole('combobox', { name: 'Address or search' }), `${target.url}{Enter}`);
      webview = document.querySelector('webview') as unknown as WebviewTag;
      attachNavigationMethods();
    } else {
      if (navigation !== 'reload') next.url = 'https://example.com/next';
      fireEvent(webview, Object.assign(new Event('did-start-navigation'), { isMainFrame: true, isInPlace: navigation === 'in-page navigation' }));
    }
    fireEvent(webview, new Event('did-stop-loading'));
    pickAnnotation.mockResolvedValueOnce(next);
    await user.click(screen.getByRole('button', { name: 'Select element' }));
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'New page note');
    await user.click(screen.getByRole('button', { name: 'Send to Agent' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(captureAnnotationScreenshots).toHaveBeenCalledExactlyOnceWith('browser-interaction', [next.id]);
    expect(parseBrowserAnnotationMessage(onSend.mock.calls[0][0])?.annotations).toEqual([{ target: next, comment: 'New page note' }]);
  });

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

  it('retries a failed main-frame load and clears the error when loading restarts', async () => {
    renderBrowserPanel();
    const webview = document.querySelector('webview') as unknown as WebviewTag;
    const reload = vi.fn(() => fireEvent(webview, new Event('did-start-loading')));
    Object.assign(webview, { reload });
    const fail = (errorCode: number, isMainFrame: boolean) => fireEvent(webview, Object.assign(new Event('did-fail-load'), {
      errorCode, isMainFrame, errorDescription: 'ERR_CONNECTION_REFUSED',
    }));

    fail(-102, false);
    fail(-3, true);
    expect(screen.queryByRole('alert')).toBeNull();
    fail(-102, true);
    expect(screen.getByRole('alert')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reload', exact: true }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens the selected address suggestion instead of searching the typed title', async () => {
    writeBrowserHistory([{ title: 'Model management', url: 'https://example.com/models', visitedAt: Date.now() }]);
    renderBrowserPanel(DEFAULT_BROWSER_URL);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox', { name: 'Address or search' }), 'management');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(document.querySelector('webview')?.getAttribute('src')).toBe('https://example.com/models');
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
    // Menu contents mount on opening so the reveal animation starts with the interaction.
    expect(screen.getByRole('menu', { name: 'Browser window settings' })).toBeTruthy();
    for (const name of ['Print page', 'Capture screenshot', 'Show device toolbar', 'Open developer tools']) {
      expect(screen.getByRole('menuitem', { name })).toBeTruthy();
    }
    expect(screen.getByRole('menuitem', { name: 'Reset zoom' }).textContent).toBe('100%');
    await user.click(screen.getByRole('menuitem', { name: 'Zoom in' }));

    expect(setZoomFactor).toHaveBeenCalledWith(1.1);
    expect(screen.getByRole('menuitem', { name: 'Reset zoom' }).textContent).toBe('110%');
  });

  it('opens the shared reload menu at the refresh button context point', async () => {
    const showReloadMenu = vi.fn(async () => true);
    browserBridge = createBrowserBridge({ showReloadMenu });
    renderBrowserPanel();
    Object.assign(document.querySelector('webview') as unknown as WebviewTag, {
      getWebContentsId: () => 42,
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Refresh' }), { clientX: 180, clientY: 64 });

    await waitFor(() => expect(showReloadMenu).toHaveBeenCalledWith(42, {
      hard: 'Control+Shift+KeyR',
      normal: 'Control+KeyR',
    }, { x: 180, y: 64 }));
  });

  it('renders only the attached guest menu and routes selection through its one-time action ID', async () => {
    let publishMenu: (request: BrowserContextMenuRequest | null) => void = () => undefined;
    const unsubscribe = vi.fn();
    browserBridge = createBrowserBridge({ onContextMenu: (callback) => { publishMenu = callback; return unsubscribe; } });
    renderBrowserPanel();
    Object.assign(document.querySelector('webview') as unknown as WebviewTag, { getWebContentsId: () => 42 });
    const request: BrowserContextMenuRequest = {
      id: 'menu-session', webContentsId: 99, x: 180, y: 64,
      items: [{ key: 'copy', label: 'Copy image' }, { key: 'paste', label: 'Paste', disabled: true }],
    };
    act(() => publishMenu(request));
    expect(screen.queryByRole('menuitem', { name: 'Copy image' })).toBeNull();
    act(() => publishMenu({ ...request, webContentsId: 42 }));
    const copy = await screen.findByRole('menuitem', { name: 'Copy image' });
    fireEvent.click(copy);
    expect(browserBridge.runContextMenuAction).toHaveBeenCalledWith('menu-session', 'copy');
    expect(browserBridge.dismissContextMenu).not.toHaveBeenCalled();
    act(() => publishMenu({ ...request, id: 'next-menu', webContentsId: 42 }));
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(browserBridge.dismissContextMenu).toHaveBeenCalledWith('next-menu'));
    expect(browserBridge.runContextMenuAction).toHaveBeenCalledOnce();
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

    const address = screen.getByRole('combobox', { name: 'Address or search' });
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

function BrowserPanelHarness({ url, onSendAnnotations }: { url: string; onSendAnnotations?: BrowserAnnotationSendHandler }) {
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
        reloadShortcutBindings={{
          hard: 'Control+Shift+KeyR',
          normal: 'Control+KeyR',
        }}
        translate={translate}
        onPanelMetadataChange={() => undefined}
        onSendAnnotations={onSendAnnotations}
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
    pickAnnotation: vi.fn(async () => null),
    cancelAnnotation: vi.fn(async () => undefined),
    setAnnotationMarkers: vi.fn(async () => true),
    getAnnotationAnchor: vi.fn(async () => null),
    captureScreenshot: vi.fn(async () => null),
    captureAnnotationScreenshots: vi.fn(async () => null),
    onOpenNewTab: vi.fn(() => () => undefined),
    onContextMenu: vi.fn(() => () => undefined),
    dismissContextMenu: vi.fn(async () => undefined),
    runContextMenuAction: vi.fn(async () => true),
    reloadTab: vi.fn(async () => true),
    registerTab: vi.fn(async () => false),
    resolveFavicon: vi.fn(async () => null),
    setActiveTab: vi.fn(async () => true),
    setDeviceEmulation: vi.fn(async () => true),
    showReloadMenu: vi.fn(async () => true),
    unregisterTab: vi.fn(async () => true),
    ...overrides,
  };
}
