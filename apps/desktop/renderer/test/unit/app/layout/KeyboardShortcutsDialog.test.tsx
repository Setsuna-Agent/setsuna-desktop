// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { KeyboardShortcutsDialog } from '../../../../src/app/layout/KeyboardShortcutsDialog.js';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { KeyboardShortcutsProvider, KEYBOARD_SHORTCUTS_STORAGE_KEY } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';

afterEach(() => { cleanup(); localStorage.clear(); });

function Overview({ onNewChat }: { onNewChat(): void }) {
  const [open, setOpen] = useState(false);
  useAppKeyboardShortcuts({ 'app.newChat': { execute: onNewChat } });
  return <>
    <button onClick={() => setOpen(true)}>Open shortcuts</button>
    {open ? <KeyboardShortcutsDialog onClose={() => setOpen(false)} /> : null}
  </>;
}

it.each(['darwin', 'win32'] as const)('searches current bindings on %s and restores focus without executing or changing shortcuts', async (platform) => {
  const binding = platform === 'darwin' ? 'Shift+Meta+Digit9' : 'Control+Shift+Digit9';
  localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify({
    version: 1, platforms: { [platform]: { 'app.newChat': [binding], 'app.addProject': [] } },
  }));
  const onNewChat = vi.fn();
  const user = userEvent.setup();
  render(<I18nProvider initialLocale="zh-CN"><KeyboardShortcutsProvider initialPlatform={platform}>
    <Overview onNewChat={onNewChat} />
  </KeyboardShortcutsProvider></I18nProvider>);
  const savedBindings = localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
  const trigger = screen.getByRole('button', { name: 'Open shortcuts' });
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '键盘快捷键' });
  const search = within(dialog).getByRole('searchbox', { name: '搜索快捷键' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  await user.type(search, platform === 'darwin' ? 'Shift + Command + 9' : 'Ctrl+Shift+9');
  expect(within(dialog).getByText('新建对话')).toBeTruthy();
  expect(within(dialog).queryByText('搜索对话内容')).toBeNull();
  await user.clear(search);
  await user.type(search, '添加项目');
  expect(within(dialog).getByText('没有匹配的快捷键。')).toBeTruthy();

  const key = { key: '9', code: 'Digit9', shiftKey: true, metaKey: platform === 'darwin', ctrlKey: platform === 'win32' };
  fireEvent.keyDown(search, key);
  expect(onNewChat).not.toHaveBeenCalled();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY)).toBe(savedBindings);
  fireEvent.keyDown(trigger, key);
  expect(onNewChat).toHaveBeenCalledOnce();
});
