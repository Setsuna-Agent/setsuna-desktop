// @vitest-environment happy-dom
import { StrictMode, useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { BrowserDesktopBridge } from '../../../src/contracts/bridge.js';
import type { BrowserExtension } from '../../../src/contracts/extensions.js';
import { DEFAULT_BROWSER_PREFERENCES } from '../../../src/contracts/settings.js';
import { BrowserSettingsPage } from '../../../src/renderer/settings/BrowserSettingsPage.js';
import { BrowserSettingsNavigationProvider, useBrowserSettingsNavigation } from '../../../src/renderer/settings/context.js';
import { translateBrowserMessage } from '../../../src/renderer/messages.js';
import { BROWSER_HISTORY_STORAGE_KEY, readBrowserHistory, writeBrowserHistory } from '../../../src/renderer/browserHistory.js';
import { settingsTestUi } from './settingsTestUi.js';
import { BROWSER_EXTENSION_PINS_KEY } from '../../../src/renderer/extensions/useBrowserExtensionPins.js';

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(BROWSER_HISTORY_STORAGE_KEY);
  window.localStorage.removeItem(BROWSER_EXTENSION_PINS_KEY);
});

function openSettings() {
  const openPage = vi.fn();
  const bridge = {
    getBrowserPreferences: vi.fn().mockResolvedValue(DEFAULT_BROWSER_PREFERENCES),
    onBrowserPreferencesChanged: () => () => undefined,
    listBrowserPasswords: vi.fn().mockResolvedValue([{ id: 'saved', origin: 'https://example.org', username: 'test-user' }]),
    getExtensions: vi.fn().mockResolvedValue([]),
    onExtensionsChanged: () => () => undefined,
  } as unknown as BrowserDesktopBridge;
  render(<StrictMode><BrowserSettingsNavigationProvider value={{ openPage, openSettings: vi.fn() }}>
    <BrowserSettingsPage bridge={bridge} ui={settingsTestUi as SettingsViewUi} translate={(key) => translateBrowserMessage('en-US', key)} />
  </BrowserSettingsNavigationProvider></StrictMode>);
  return { bridge, openPage };
}

function ExtensionSettingsShortcut() {
  const navigation = useBrowserSettingsNavigation();
  return <button onClick={navigation?.openExtensionSettings}>Open extension settings</button>;
}

it('opens the requested extension subpage, toggles without uninstalling and returns to browser preferences', async () => {
  const extension: BrowserExtension = {
    id: 'a'.repeat(32), name: 'Test extension', version: '1', enabled: true,
    icon: null, actionIcon: null, hasPopup: true, hasOptions: true, newTabUrl: null,
  };
  let changed: (items: readonly BrowserExtension[]) => void = () => undefined;
  const setExtensionEnabled = vi.fn(async (_id: string, enabled: boolean) => {
    changed([{ ...extension, enabled }]);
    return true;
  });
  const removeExtension = vi.fn(async () => true);
  const bridge = {
    getBrowserPreferences: async () => DEFAULT_BROWSER_PREFERENCES,
    onBrowserPreferencesChanged: () => () => undefined,
    getExtensions: async () => [extension],
    onExtensionsChanged: (listener: typeof changed) => { changed = listener; return () => undefined; },
    setExtensionEnabled, removeExtension,
  } as unknown as BrowserDesktopBridge;
  const openSettings = vi.fn();
  function Harness() {
    const [opened, setOpened] = useState(false);
    return <BrowserSettingsNavigationProvider value={{
      openSettings: (section) => { openSettings(section); setOpened(true); }, openPage: vi.fn(),
    }}>
      <ExtensionSettingsShortcut />
      {opened ? <BrowserSettingsPage bridge={bridge} ui={settingsTestUi as SettingsViewUi} translate={(key) => translateBrowserMessage('en-US', key)} /> : null}
    </BrowserSettingsNavigationProvider>;
  }
  render(<StrictMode><Harness /></StrictMode>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open extension settings' }));
  expect(openSettings).toHaveBeenCalledExactlyOnceWith('browser');
  await user.click(await screen.findByRole('button', { name: 'Pin to toolbar' }));
  await user.click(screen.getByRole('switch', { name: `Disable extension ${extension.name}` }));
  expect(setExtensionEnabled).toHaveBeenLastCalledWith(extension.id, false);
  expect(JSON.parse(window.localStorage.getItem(BROWSER_EXTENSION_PINS_KEY)!)).toEqual([extension.id]);
  await user.click(screen.getByRole('switch', { name: `Enable extension ${extension.name}` }));
  expect(setExtensionEnabled).toHaveBeenLastCalledWith(extension.id, true);
  expect(removeExtension).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Back', exact: true }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Allow AI to control the built-in browser' })).toBeTruthy());
});

it('opens each browser management page and returns to browser preferences', async () => {
  const { bridge } = openSettings();
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Saved passwords' });
  for (const name of ['Saved passwords', 'Favorites', 'Site exceptions', 'Extensions']) {
    await user.click(screen.getByRole('button', { name }));
    if (name === 'Saved passwords') expect(await screen.findByText('test-user')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back', exact: true }));
    expect(screen.getByRole('checkbox', { name: 'Allow AI to control the built-in browser' })).toBeTruthy();
  }
  expect(bridge.listBrowserPasswords).toHaveBeenCalled();
});

it('searches folded history, opens an entry, and clears history only after confirmation', async () => {
  const visitedAt = new Date(2026, 9, 4, 13, 31).getTime();
  const entry = { title: 'Example documentation', url: 'https://example.org/docs', visitedAt };
  writeBrowserHistory([entry]);
  const { openPage } = openSettings();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Browsing history' }));
  const day = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(visitedAt);
  await user.click(screen.getByRole('button', { name: day, exact: true }));
  expect(screen.queryByRole('button', { name: 'Open Example documentation' })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'Search history' }), 'documentation');
  await user.click(screen.getByRole('button', { name: 'Open Example documentation' }));
  expect(openPage).toHaveBeenCalledWith(entry.url);
  await user.click(screen.getByRole('button', { name: 'Clear all history' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(readBrowserHistory()).toEqual([entry]);
  await user.click(screen.getByRole('button', { name: 'Clear all history' }));
  await user.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(readBrowserHistory()).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Back', exact: true }));
  expect(screen.getByRole('button', { name: 'Browsing history' })).toBeTruthy();
});
