// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import type { SettingsViewUi } from '@setsuna-desktop/renderer-contracts/settings';
import { afterEach, expect, it, vi } from 'vitest';
import { BROWSER_HISTORY_STORAGE_KEY, readBrowserHistory, writeBrowserHistory } from '../../../src/renderer/browserHistory.js';
import { translateBrowserMessage, type BrowserTranslate } from '../../../src/renderer/messages.js';
import { BrowserHistoryRecords } from '../../../src/renderer/records/BrowserHistoryRecords.js';
import { BrowserHistoryPage } from '../../../src/renderer/settings/BrowserHistoryPage.js';
import { settingsTestUi } from '../settings/settingsTestUi.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem(BROWSER_HISTORY_STORAGE_KEY);
});

it.each(['panel', 'settings'])('reports consecutive history cleanup failures in %s and keeps records until saving succeeds', async (surface) => {
  const original = [{ title: 'Example', url: 'https://example.org/', visitedAt: Date.now() }];
  writeBrowserHistory(original);
  const translate: BrowserTranslate = (key) => translateBrowserMessage('en-US', key);
  render(<ToastProvider closeLabel="Dismiss notification">
    {surface === 'panel' ? <BrowserHistoryRecords translate={translate} onClose={vi.fn()} />
      : <BrowserHistoryPage translate={translate} ui={settingsTestUi as SettingsViewUi} />}
  </ToastProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: translate('feature.browser.records.clearHistory') }));
  const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(screen.getByRole('button', { name: translate('feature.browser.records.confirmDelete') }));
      const notice = await screen.findByRole('alert');
      expect(notice.textContent).toContain(translate('feature.browser.settings.failed'));
      expect(readBrowserHistory()).toEqual(original);
      fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss notification' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    }
    expect(write).toHaveBeenCalledTimes(2);
  } finally {
    write.mockRestore();
  }
  await user.click(screen.getByRole('button', { name: translate('feature.browser.records.confirmDelete') }));
  expect(readBrowserHistory()).toEqual([]);
  expect(screen.queryByRole('button', { name: translate('feature.browser.records.confirmDelete') })).toBeNull();
});
