// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebviewTag } from 'electron';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserDesktopBridge } from '../../src/contracts/index.js';
import { BrowserPanel } from '../../src/renderer/BrowserPanel.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';

const translate = (key: Parameters<typeof translateBrowserMessage>[1]) => (
  translateBrowserMessage('en-US', key)
);
let browserBridge = createBrowserBridge();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browserBridge = createBrowserBridge();
});

describe('BrowserPanel interactions', () => {
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

function renderBrowserPanel() {
  return render(<BrowserPanelHarness />);
}

function BrowserPanelHarness() {
  const [notification, setNotification] = useState<string | null>(null);
  const notify = useCallback((_tone: string, message: string) => setNotification(message), []);
  return (
    <>
      <BrowserPanel
        bridge={browserBridge}
        hidden={false}
        notify={notify}
        panel={{
          browser: { faviconUrl: null, loading: false, url: 'https://example.com' },
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
