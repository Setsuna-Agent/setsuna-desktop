// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import type { BrowserDesktopBridge } from '../../../src/contracts/bridge.js';
import { BrowserPasswordManager } from '../../../src/renderer/settings/BrowserPasswordManager.js';
import { translateBrowserMessage } from '../../../src/renderer/messages.js';
import { settingsTestUi } from './settingsTestUi.js';

const login = { id: 'saved-login', origin: 'https://example.org', username: 'test-user' };

afterEach(cleanup);

function openManager(listBrowserPasswords: BrowserDesktopBridge['listBrowserPasswords'], operations: Partial<BrowserDesktopBridge> = {}) {
  const bridge = { ...operations, listBrowserPasswords } as BrowserDesktopBridge;
  render(<StrictMode><BrowserPasswordManager bridge={bridge} ui={settingsTestUi as SettingsViewUi}
    translate={(key) => translateBrowserMessage('en-US', key)} /></StrictMode>);
}

it('loads saved passwords when React replays initialization, then filters the returned accounts', async () => {
  openManager(vi.fn().mockResolvedValue([login]));
  expect(await screen.findByText(login.origin)).toBeTruthy();
  expect(screen.getByText(login.username)).toBeTruthy();
  expect(screen.queryByText('No entries')).toBeNull();
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Search' }), 'missing');
  expect(screen.queryByText(login.origin)).toBeNull();
  expect(screen.getByText('No entries')).toBeTruthy();
  await user.clear(screen.getByRole('textbox', { name: 'Search' }));
  expect(screen.getByText(login.origin)).toBeTruthy();
});

it('does not present a failed password read as an empty vault', async () => {
  openManager(vi.fn().mockRejectedValue(new Error('Vault unavailable')));
  expect(await screen.findByText('Operation failed. Try again.')).toBeTruthy();
  expect(screen.queryByText('No entries')).toBeNull();
});

it('refreshes saved accounts after deleting and adding a password', async () => {
  let entries = [login];
  const deleteBrowserPassword = vi.fn(async () => { entries = []; });
  const saveBrowserPassword = vi.fn(async (input: { origin: string; username: string; password: string }) => {
    entries = [{ id: 'new-login', origin: input.origin, username: input.username }];
  });
  openManager(async () => entries, { deleteBrowserPassword, saveBrowserPassword });
  await screen.findByText(login.username);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('No entries')).toBeTruthy();
  expect(deleteBrowserPassword).toHaveBeenCalledWith(login.origin, login.id);
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await user.type(screen.getByLabelText('Website URL'), 'https://example.org/login');
  await user.type(screen.getByLabelText('Username'), 'new-user');
  await user.type(screen.getByLabelText('Password'), 'test-secret');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('new-user')).toBeTruthy();
  expect(saveBrowserPassword).toHaveBeenCalledWith({ origin: login.origin, username: 'new-user', password: 'test-secret' });
});

it('edits and deletes the intended account when a website has multiple saved accounts', async () => {
  const second = { ...login, id: 'second-login', username: 'second-user' };
  const other = { ...login, id: 'other-site', origin: 'https://other.org', username: 'other-user' };
  let entries = [login, second, other];
  const saveBrowserPassword = vi.fn(async () => undefined);
  const deleteBrowserPassword = vi.fn(async (origin: string, id: string) => {
    entries = entries.filter((entry) => entry.origin !== origin || entry.id !== id);
  });
  openManager(async () => entries, { saveBrowserPassword, deleteBrowserPassword });
  const user = userEvent.setup();
  const accountRow = (username: string) => within(screen.getByText(username).closest('li')!);
  await screen.findByText(second.username);
  await user.click(accountRow(second.username).getByRole('button', { name: 'Edit' }));
  expect((screen.getByLabelText('Website URL') as HTMLInputElement).value).toBe(second.origin);
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe(second.username);
  await user.type(screen.getByLabelText('Password'), 'updated-secret');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(second.username);
  expect(saveBrowserPassword).toHaveBeenCalledWith({ origin: second.origin, username: second.username, password: 'updated-secret' });

  await user.click(accountRow(second.username).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByText(second.username)).toBeNull());
  expect(deleteBrowserPassword).toHaveBeenCalledWith(second.origin, second.id);
  expect(screen.getByText(login.username)).toBeTruthy();
  expect(screen.getByText(other.username)).toBeTruthy();
});
