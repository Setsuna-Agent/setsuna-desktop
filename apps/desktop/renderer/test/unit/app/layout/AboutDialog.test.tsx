// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ShellFrame } from '../../../../src/app/layout/ShellFrame.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('opens app information from Help, handles external link failure and retry, and restores menu focus on close', async () => {
  const openExternal = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  vi.stubGlobal('setsunaDesktop', {
    desktop: { platform: 'win32', setInterfaceLanguage: vi.fn(async () => true) },
    links: { openExternal },
  });
  render(<I18nProvider initialLocale="zh-CN"><ShellFrame /></I18nProvider>);
  const help = screen.getByRole('button', { name: '帮助' });
  fireEvent.click(help);
  fireEvent.click(screen.getByRole('menuitem', { name: '关于 Setsuna Desktop' }));
  const dialog = screen.getByRole('dialog', { name: '关于 Setsuna Desktop' });
  expect(within(dialog).getByText(/^v\d+\.\d+\.\d+/u)).toBeTruthy();
  expect(within(dialog).getByText('Windows')).toBeTruthy();
  expect(within(dialog).getByText('MIT')).toBeTruthy();

  const clickReleaseNotes = async () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => { within(dialog).getByRole('link', { name: '更新日志' }).dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  };
  await clickReleaseNotes();
  expect(openExternal).toHaveBeenCalledWith('https://github.com/Setsuna-Agent/setsuna-desktop/releases');
  expect(within(dialog).getByRole('alert').textContent).toContain('链接打开失败');
  await clickReleaseNotes();
  expect(within(dialog).queryByRole('alert')).toBeNull();

  fireEvent.click(within(dialog).getAllByRole('button', { name: '关闭' }).at(-1)!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(help);
});
