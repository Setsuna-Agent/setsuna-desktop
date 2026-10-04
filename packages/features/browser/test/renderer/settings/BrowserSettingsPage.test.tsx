// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { BrowserDesktopBridge } from '../../../src/contracts/bridge.js';
import { DEFAULT_BROWSER_PREFERENCES } from '../../../src/contracts/settings.js';
import { BrowserSettingsPage } from '../../../src/renderer/settings/BrowserSettingsPage.js';
import { BrowserSettingsNavigationProvider } from '../../../src/renderer/settings/context.js';
import { translateBrowserMessage } from '../../../src/renderer/messages.js';
import { BROWSER_HISTORY_STORAGE_KEY, readBrowserHistory, writeBrowserHistory } from '../../../src/renderer/browserHistory.js';
import { settingsTestUi } from './settingsTestUi.js';

afterEach(() => { cleanup(); window.localStorage.removeItem(BROWSER_HISTORY_STORAGE_KEY); });

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

it('opens each browser management page and returns to browser preferences', async () => {
  const { bridge } = openSettings();
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Saved passwords' });
  for (const name of ['Saved passwords', 'Bookmarks', 'Site exceptions', 'Extensions']) {
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
