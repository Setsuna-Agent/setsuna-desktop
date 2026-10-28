// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { KeyboardShortcutsSettings } from '../../../../../src/features/settings/shortcuts/KeyboardShortcutsSettings.js';
import { KeyboardShortcutsProvider, KEYBOARD_SHORTCUTS_STORAGE_KEY } from '../../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';

afterEach(() => { cleanup(); localStorage.clear(); });
function press(input: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...input });
  act(() => window.dispatchEvent(event)); return event;
}
it.each([false, true])('releases recording for Tab navigation (shift=%s) without changing a binding', (shiftKey) => {
  render(<KeyboardShortcutsProvider initialPlatform="win32"><KeyboardShortcutsSettings /></KeyboardShortcutsProvider>);
  fireEvent.click(screen.getAllByRole('button', { name: /^修改快捷键/ })[0]);
  const before = localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
  expect(press({ key: 'Tab', code: 'Tab', shiftKey }).defaultPrevented).toBe(false);
  expect(screen.queryByText('请按键…')).toBeNull();
  expect(localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY)).toBe(before);
});
it('ignores composing and repeated keys, then accepts the next deliberate chord', () => {
  render(<KeyboardShortcutsProvider initialPlatform="win32"><KeyboardShortcutsSettings /></KeyboardShortcutsProvider>);
  fireEvent.click(screen.getAllByRole('button', { name: /^修改快捷键/ })[0]);
  const before = localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
  expect(press({ key: 'Process', code: 'KeyA', isComposing: true }).defaultPrevented).toBe(false);
  press({ key: 'u', code: 'KeyU', ctrlKey: true, repeat: true });
  expect(localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY)).toBe(before);
  press({ key: 'u', code: 'KeyU', ctrlKey: true });
  expect(localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY)).toContain('Control+KeyU');
});
