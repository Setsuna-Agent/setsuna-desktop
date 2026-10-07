// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebviewTag } from 'electron';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_WEB_STORE_URL, DEFAULT_BROWSER_URL, DEFAULT_BROWSER_PREFERENCES, parseBrowserAnnotationMessage, type BrowserAnnotationSendHandler,
  type BrowserAnnotationTarget, type BrowserContextMenuRequest, type BrowserDesktopBridge, type BrowserExtension,
} from '../../src/contracts/index.js';
import { BrowserPanel } from '../../src/renderer/BrowserPanel.js';
import {
  BROWSER_BOOKMARKS_STORAGE_KEY,
  readBrowserBookmarks,
  writeBrowserBookmarkTree,
} from '../../src/renderer/browserBookmarks.js';
import { BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID, emptyBookmarkTree, removeBookmarkNode, saveBookmarkNode } from '../../src/renderer/records/bookmarkTree.js';
import {
  BROWSER_HISTORY_STORAGE_KEY,
  readBrowserHistory,
  writeBrowserHistory,
} from '../../src/renderer/browserHistory.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';
import { BROWSER_EXTENSION_PINS_KEY } from '../../src/renderer/extensions/useBrowserExtensionPins.js';
import { BrowserSettingsNavigationProvider } from '../../src/renderer/settings/context.js';

const translate = (key: Parameters<typeof translateBrowserMessage>[1]) => (
  translateBrowserMessage('en-US', key)
);
let browserBridge = createBrowserBridge();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem(BROWSER_BOOKMARKS_STORAGE_KEY);
  window.localStorage.removeItem(BROWSER_HISTORY_STORAGE_KEY);
  window.localStorage.removeItem(BROWSER_EXTENSION_PINS_KEY);
  browserBridge = createBrowserBridge();
});

describe('BrowserPanel interactions', () => {
  it('finds in its own page, navigates matches with Enter and Shift+Enter, and clears find on Escape or navigation', async () => {
    let requested: (tabId: string) => void = () => undefined;
    browserBridge = createBrowserBridge({ onFindInPageRequested: (listener) => { requested = listener; return () => undefined; } });
    renderBrowserPanel();
    const node = document.querySelector('webview')!;
    let requestId = 0;
    const findInPage = vi.fn(() => ++requestId);
    const stopFindInPage = vi.fn();
    const focus = vi.fn();
    Object.assign(node, { findInPage, stopFindInPage, focus });
    act(() => requested('another-browser'));
    expect(screen.queryByRole('search')).toBeNull();
    act(() => requested('browser-interaction'));
    const input = screen.getByRole('textbox', { name: 'Find in page' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'page text' } });
    expect(findInPage).toHaveBeenLastCalledWith('page text', { findNext: true, forward: true });
    act(() => node.dispatchEvent(Object.assign(new Event('found-in-page'), {
      result: { requestId, activeMatchOrdinal: 1, matches: 2, finalUpdate: true },
    })));
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(findInPage).toHaveBeenLastCalledWith('page text', { findNext: false, forward: true });
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(findInPage).toHaveBeenLastCalledWith('page text', { findNext: false, forward: false });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('search')).toBeNull();
    expect(stopFindInPage).toHaveBeenCalledWith('clearSelection');
    expect(focus).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Address or search' }), { code: 'KeyF', key: 'f', ctrlKey: true });
    expect(screen.getByRole('textbox', { name: 'Find in page' })).toBeTruthy();
    act(() => node.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isMainFrame: true, isInPlace: false })));
    expect(screen.queryByRole('search')).toBeNull();
  });
  it('opens browser settings from the internal home page and uses the configured search engine', async () => {
    browserBridge = createBrowserBridge({ getBrowserPreferences: async () => ({ ...DEFAULT_BROWSER_PREFERENCES, searchEngine: 'baidu' }) });
    const openSettings = vi.fn();
    render(<BrowserSettingsNavigationProvider value={{ openSettings, openPage: vi.fn() }}><BrowserPanelHarness url={DEFAULT_BROWSER_URL} /></BrowserSettingsNavigationProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Browser settings' }));
    expect(openSettings).toHaveBeenCalledWith('browser');
    const address = screen.getByRole('combobox', { name: 'Address or search' });
    await user.type(address, 'test browser{Enter}');
    await waitFor(() => expect(document.querySelector('webview')?.getAttribute('src')).toBe('https://www.baidu.com/s?wd=test%20browser'));
  });

  it('opens extension management and the Chrome Web Store from the browser extensions menu', async () => {
    const openSettings = vi.fn();
    render(<BrowserSettingsNavigationProvider value={{ openSettings, openPage: vi.fn() }}><BrowserPanelHarness /></BrowserSettingsNavigationProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Extensions', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Manage extensions' }));
    expect(openSettings).toHaveBeenCalledExactlyOnceWith('browser');
    expect(screen.queryByRole('dialog', { name: 'Extensions' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Extensions', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Chrome Web Store' }));
    await waitFor(() => expect(document.querySelector('webview')?.getAttribute('src')).toBe(BROWSER_WEB_STORE_URL));
  });
  const newTabExtension: BrowserExtension = {
    id: 'a'.repeat(32), name: 'Test new tab', version: '1', enabled: true, icon: null, actionIcon: null, hasOptions: false, hasPopup: false,
    description: '', permissions: [], hostPermissions: [], supportsUserScripts: false, allowUserScripts: false,
    newTabUrl: `chrome-extension://${'a'.repeat(32)}/newtab.html`,
  };

  it('searches, removes and reopens history from the menu when an extension owns the new tab page', async () => {
    writeBrowserHistory([
      { title: 'Documentation', url: 'https://example.org/docs', visitedAt: 200 },
      { title: 'Home page', url: 'https://example.org/', visitedAt: 100 },
    ]);
    browserBridge = createBrowserBridge({ getExtensions: async () => [newTabExtension] });
    renderBrowserPanel(DEFAULT_BROWSER_URL);
    await waitFor(() => expect(document.querySelector('webview')?.getAttribute('src')).toBe(newTabExtension.newTabUrl));
    const loadURL = vi.fn(async () => undefined);
    Object.assign(document.querySelector('webview')!, { loadURL });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Browsing history' }));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'docs');
    expect(screen.queryByRole('button', { name: 'Open Home page' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Delete Documentation' }));
    expect(readBrowserHistory().map((entry) => entry.url)).toEqual(['https://example.org/']);
    await user.clear(screen.getByRole('textbox', { name: 'Search' }));
    await user.click(screen.getByRole('button', { name: 'Open Home page' }));
    await waitFor(() => expect(loadURL).toHaveBeenCalledWith('https://example.org/'));
    expect(screen.queryByRole('dialog', { name: 'Browsing history' })).toBeNull();
  });

  it('edits a saved bookmark from the menu, synchronizes the star, and opens the edited address', async () => {
    renderBrowserPanel();
    const loadURL = vi.fn(async () => undefined);
    Object.assign(document.querySelector('webview')!, { loadURL });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add current page to favorites' }));
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Favorites' }));
    await user.click(screen.getByRole('button', { name: 'Edit New tab' }));
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Example docs');
    await user.clear(screen.getByRole('textbox', { name: 'URL' }));
    await user.type(screen.getByRole('textbox', { name: 'URL' }), 'https://example.org/docs');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(readBrowserBookmarks()).toMatchObject([{ title: 'Example docs', url: 'https://example.org/docs' }]);
    await user.click(screen.getByRole('button', { name: 'Open Example docs' }));
    await waitFor(() => expect(loadURL).toHaveBeenCalledWith('https://example.org/docs'));
    expect(screen.getByRole('button', { name: 'Remove current page from favorites' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Favorites' }));
    await user.click(screen.getByRole('button', { name: 'Delete Example docs' }));
    expect(readBrowserBookmarks()).toEqual([]);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Add current page to favorites' })).toBeTruthy();
  });

  it('clears all history after confirmation even when search is filtered, without deleting bookmarks', async () => {
    writeBrowserHistory([
      { title: 'Docs', url: 'https://example.org/docs', visitedAt: Date.now() },
      { title: 'Home', url: 'https://example.org/', visitedAt: Date.now() - 86_400_000 },
    ]);
    renderBrowserPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add current page to favorites' }));
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Browsing history' }));
    expect(screen.queryByRole('menuitem', { name: 'Browsing history' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'docs');
    await user.click(screen.getByRole('button', { name: 'Clear all history' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(readBrowserHistory()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Clear all history' }));
    await user.click(screen.getByRole('button', { name: 'Confirm deletion' }));
    expect(readBrowserHistory()).toEqual([]);
    expect(readBrowserBookmarks()).toHaveLength(1);
    const webview = document.querySelector('webview')!;
    Object.assign(webview, { getURL: () => 'https://example.com/', getZoomFactor: () => 1, canGoBack: () => false, canGoForward: () => false });
    act(() => webview.dispatchEvent(Object.assign(new Event('page-title-updated'), { title: 'Late title' })));
    expect(readBrowserHistory()).toEqual([]);
    act(() => webview.dispatchEvent(new Event('did-navigate')));
    expect(readBrowserHistory()).toMatchObject([{ url: 'https://example.com/' }]);
  });

  it('keeps pinned records open while navigating, switches the records kind from the menu and closes it from the active toolbar button', async () => {
    writeBrowserHistory([{ title: 'Docs', url: 'https://example.org/docs', visitedAt: Date.now() }]);
    renderBrowserPanel();
    const loadURL = vi.fn(async () => undefined);
    Object.assign(document.querySelector('webview')!, { loadURL });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Browsing history' }));
    await user.click(screen.getByRole('button', { name: 'Pin to sidebar' }));
    await user.click(screen.getByRole('button', { name: 'Open Docs' }));
    await waitFor(() => expect(loadURL).toHaveBeenCalledWith('https://example.org/docs'));
    expect(screen.getByRole('region', { name: 'Browsing history' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Favorites' }));
    expect(screen.queryByRole('region', { name: 'Browsing history' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Favorites' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Favorites', exact: true }));
    expect(screen.queryByRole('region', { name: 'Favorites' })).toBeNull();
  });

  it('keeps extension controls usable, then dismisses the menu on outside pointer input or Escape', async () => {
    browserBridge = createBrowserBridge({ getExtensions: async () => [{ ...newTabExtension, newTabUrl: null }] });
    renderBrowserPanel('https://example.com');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Extensions', exact: true }));
    await user.click(await screen.findByRole('button', { name: `Pin to toolbar ${newTabExtension.name}` }));
    expect(screen.getByRole('dialog', { name: 'Extensions' })).toBeTruthy();
    await user.click(document.documentElement);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extensions' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Extensions', exact: true }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Extensions' })).toBeNull());
  });

  it.each(['options', 'unpin', 'remove'])('runs %s from a pinned extension context menu without opening its popup', async (action) => {
    const extension = { ...newTabExtension, hasPopup: true, hasOptions: true, newTabUrl: null };
    const openExtension = vi.fn(async () => true);
    const removeExtension = vi.fn(async () => true);
    window.localStorage.setItem(BROWSER_EXTENSION_PINS_KEY, JSON.stringify([extension.id]));
    browserBridge = createBrowserBridge({ getExtensions: async () => [extension], openExtension, removeExtension });
    renderBrowserPanel(DEFAULT_BROWSER_URL);
    fireEvent.contextMenu(await screen.findByRole('button', { name: extension.name, exact: true }), { clientX: 120, clientY: 30 });
    expect(openExtension).not.toHaveBeenCalled();
    const label = { options: 'Extension options', unpin: 'Unpin from toolbar', remove: 'Remove extension' }[action];
    const user = userEvent.setup();
    await user.click(await screen.findByRole('menuitem', { name: label }));
    if (action === 'options') expect(openExtension).toHaveBeenCalledExactlyOnceWith(extension.id, 'options', undefined, undefined);
    if (action === 'remove') expect(removeExtension).toHaveBeenCalledExactlyOnceWith(extension.id);
    if (action === 'unpin') expect(JSON.parse(window.localStorage.getItem(BROWSER_EXTENSION_PINS_KEY)!)).toEqual([]);
    expect(openExtension).not.toHaveBeenCalledWith(extension.id, 'popup');
  });

  it('invokes an action-only extension from the menu and pinned toolbar, preserving its pin across disabling and re-enabling', async () => {
    const extension = { ...newTabExtension, hasPopup: false, hasOptions: false, hasAction: true, hasSidePanel: true, newTabUrl: null };
    let changed: (extensions: readonly BrowserExtension[]) => void = () => undefined;
    const openExtension = vi.fn(async () => true);
    browserBridge = createBrowserBridge({
      getExtensions: async () => [extension], openExtension,
      onExtensionsChanged: (listener) => { changed = listener; return () => undefined; },
    });
    renderBrowserPanel(DEFAULT_BROWSER_URL);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Extensions', exact: true }));
    await user.click(await screen.findByRole('button', { name: extension.name, exact: true }));
    await waitFor(() => expect(openExtension).toHaveBeenCalledExactlyOnceWith(extension.id, 'action', expect.any(Object), undefined));
    openExtension.mockClear();
    await user.click(screen.getByRole('button', { name: 'Extensions', exact: true }));
    await user.click(await screen.findByRole('button', { name: `Pin to toolbar ${extension.name}` }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: extension.name, exact: true }));
    await waitFor(() => expect(openExtension).toHaveBeenCalledExactlyOnceWith(extension.id, 'action', expect.any(Object), undefined));
    expect(JSON.parse(window.localStorage.getItem(BROWSER_EXTENSION_PINS_KEY)!)).toEqual([extension.id]);
    act(() => changed([{ ...extension, enabled: false }]));
    expect(JSON.parse(window.localStorage.getItem(BROWSER_EXTENSION_PINS_KEY)!)).toEqual([extension.id]);
    act(() => changed([extension]));
    await user.click(screen.getByRole('button', { name: extension.name, exact: true }));
    expect(openExtension).toHaveBeenCalledTimes(2);
    act(() => changed([]));
    expect(screen.queryByRole('button', { name: extension.name, exact: true })).toBeNull();
  });

  it('opens the extension for a new tab and Home, falls back when disabled, restores on enable and falls back after uninstall', async () => {
    let changed: (extensions: readonly BrowserExtension[]) => void = () => undefined;
    browserBridge = createBrowserBridge({
      getExtensions: async () => [newTabExtension],
      onExtensionsChanged: (listener) => { changed = listener; return () => undefined; },
    });
    renderBrowserPanel(DEFAULT_BROWSER_URL);
    await waitFor(() => expect(document.querySelector('webview')?.getAttribute('src')).toBe(newTabExtension.newTabUrl));
    const webview = document.querySelector('webview') as unknown as WebviewTag;
    const loadURL = vi.fn(async () => undefined);
    Object.assign(webview, { loadURL });
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox', { name: 'Address or search' }), 'https://example.com{Enter}');
    await waitFor(() => expect(loadURL).toHaveBeenCalledWith('https://example.com'));
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(loadURL).toHaveBeenLastCalledWith(newTabExtension.newTabUrl));
    act(() => changed([{ ...newTabExtension, enabled: false, newTabUrl: null }]));
    await waitFor(() => expect(document.querySelector('webview')).toBeNull());
    act(() => changed([newTabExtension]));
    await waitFor(() => expect(document.querySelector('webview')?.getAttribute('src')).toBe(newTabExtension.newTabUrl));
    act(() => changed([]));
    await waitFor(() => expect(document.querySelector('webview')).toBeNull());
  });

  it('does not replace a website when installed-extension metadata arrives after navigation', async () => {
    let resolve: (extensions: readonly BrowserExtension[]) => void = () => undefined;
    browserBridge = createBrowserBridge({ getExtensions: () => new Promise((done) => { resolve = done; }) });
    renderBrowserPanel(DEFAULT_BROWSER_URL);
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox', { name: 'Address or search' }), 'https://example.com{Enter}');
    act(() => resolve([newTabExtension]));
    await waitFor(() => expect(document.querySelector('webview')?.getAttribute('src')).toBe('https://example.com'));
  });

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

    await user.click(screen.getByRole('button', { name: 'Add current page to favorites' }));
    expect(readBrowserBookmarks()).toMatchObject([{
      title: 'New tab',
      url: 'https://example.com/',
    }]);

    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('button', { name: 'Open New tab' })).toBeTruthy();
  });

  it('keeps same-URL bookmarks distinct on home when another folder adds or removes a bookmark', async () => {
    let tree = saveBookmarkNode(emptyBookmarkTree(), { title: 'Work docs', url: 'https://example.com/docs', parentId: BOOKMARK_BAR_ID },
      { id: 'work-docs', type: 'bookmark', create: true, dateAdded: 100 })!;
    tree = saveBookmarkNode(tree, { title: 'Personal docs', url: 'https://example.com/docs', parentId: OTHER_BOOKMARKS_ID },
      { id: 'personal-docs', type: 'bookmark', create: true, dateAdded: 200 })!;
    writeBrowserBookmarkTree(tree);
    await act(async () => { renderBrowserPanel(DEFAULT_BROWSER_URL); });
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2);

    tree = saveBookmarkNode(tree, { title: 'New page', url: 'https://example.org/', parentId: BOOKMARK_BAR_ID },
      { id: 'new-page', type: 'bookmark', create: true, dateAdded: 300 })!;
    act(() => writeBrowserBookmarkTree(tree));
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3);
    act(() => writeBrowserBookmarkTree(removeBookmarkNode(tree, 'work-docs')));
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Open Work docs' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Personal docs' }));
    expect(document.querySelector('webview')?.getAttribute('src')).toBe('https://example.com/docs');
  });

  it('records successful main-frame navigations with their page title', async () => {
    await act(async () => { renderBrowserPanel(); });
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

  it.each([false, true])('waits for the saved history preference (%s) before recording navigation', async (rememberHistory) => {
    let resolve!: (value: typeof DEFAULT_BROWSER_PREFERENCES) => void;
    browserBridge = createBrowserBridge({ getBrowserPreferences: () => new Promise((done) => { resolve = done; }) });
    renderBrowserPanel();
    const webview = document.querySelector('webview')!;
    let url = 'https://example.com/before-preferences';
    Object.assign(webview, {
      getURL: () => url, getZoomFactor: () => 1, canGoBack: () => false, canGoForward: () => false,
    });
    fireEvent(webview, new Event('did-navigate'));
    fireEvent(webview, Object.assign(new Event('page-title-updated'), { title: 'Before preferences' }));
    expect(readBrowserHistory()).toEqual([]);

    await act(async () => resolve({ ...DEFAULT_BROWSER_PREFERENCES, rememberHistory }));
    expect(readBrowserHistory()).toEqual([]);
    url = 'https://example.com/after-preferences';
    fireEvent(webview, new Event('did-navigate'));
    fireEvent(webview, Object.assign(new Event('page-title-updated'), { title: 'After preferences' }));
    expect(readBrowserHistory().map((entry) => entry.url)).toEqual(rememberHistory ? [url] : []);
  });

  it('commits the requested zoom only after the webview accepts it', async () => {
    const setZoomFactor = vi.fn();
    renderBrowserPanel();
    installZoomMethods(setZoomFactor);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Browser menu' }));
    expect(screen.getByRole('dialog', { name: 'Browser window settings' })).toBeTruthy();
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
    getBrowserPreferences: vi.fn(async () => DEFAULT_BROWSER_PREFERENCES),
    updateBrowserPreferences: vi.fn(async () => DEFAULT_BROWSER_PREFERENCES),
    onBrowserPreferencesChanged: vi.fn(() => () => undefined),
    clearBrowserData: vi.fn(async () => undefined),
    chooseBrowserDownloadDirectory: vi.fn(async () => DEFAULT_BROWSER_PREFERENCES),
    listBrowserPasswords: vi.fn(async () => []),
    saveBrowserPassword: vi.fn(async () => undefined),
    deleteBrowserPassword: vi.fn(async () => undefined),
    getPasswordState: vi.fn(async () => null),
    getExtensions: vi.fn(async () => []),
    setExtensionEnabled: vi.fn(async () => true),
    onExtensionsChanged: vi.fn(() => () => undefined),
    openExtension: vi.fn(async () => true),
    getExtensionActions: vi.fn(async () => []),
    onExtensionActionsChanged: vi.fn(() => () => undefined),
    removeExtension: vi.fn(async () => true),
    savePassword: vi.fn(async () => true),
    dismissPassword: vi.fn(async () => undefined),
    fillPassword: vi.fn(async () => true),
    deletePassword: vi.fn(async () => true),
    onPasswordState: vi.fn(() => () => undefined),
    pickAnnotation: vi.fn(async () => null),
    requestFindInPage: vi.fn(async () => true),
    onFindInPageRequested: vi.fn(() => () => undefined),
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
