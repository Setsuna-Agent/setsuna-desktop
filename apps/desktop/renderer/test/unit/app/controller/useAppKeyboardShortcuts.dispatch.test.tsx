// @vitest-environment happy-dom
import type { DesktopKeyboardShortcutInput } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { KeyboardShortcutsProvider, KEYBOARD_SHORTCUTS_STORAGE_KEY } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';
import type { KeyboardShortcutPlatform } from '../../../../src/shared/shortcuts/keyboardShortcutCommands.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  document.body.inert = false;
});

function setup(platform: KeyboardShortcutPlatform) {
  let forwardInput!: (event: DesktopKeyboardShortcutInput) => void;
  const unsubscribe = vi.fn();
  const syncBindings = vi.fn(async () => true);
  vi.stubGlobal('setsunaDesktop', { desktop: {
    platform,
    onKeyboardShortcutInput: (listener: typeof forwardInput) => { forwardInput = listener; return unsubscribe; },
    setActiveKeyboardShortcutBindings: syncBindings,
  } });
  const openChat = vi.fn();
  const openPullRequests = vi.fn();
  const openAutomation = vi.fn();
  const toggleTheme = vi.fn();
  const handlers = {
    'app.openChat': { execute: openChat },
    'app.openPullRequests': { execute: openPullRequests },
    'app.openAutomation': { execute: openAutomation },
    'app.toggleTheme': { execute: toggleTheme },
  };
  const hook = renderHook(() => useAppKeyboardShortcuts(handlers), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <KeyboardShortcutsProvider initialPlatform={platform}>{children}</KeyboardShortcutsProvider>
    ),
  });
  return { ...hook, openChat, openPullRequests, openAutomation, toggleTheme, syncBindings, unsubscribe,
    forward: (event: DesktopKeyboardShortcutInput) => forwardInput(event) };
}

function press(input: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...input });
  act(() => { window.dispatchEvent(event); });
  return event;
}

it.each(['darwin', 'win32'] as const)('dispatches the rail commands on %s and suppresses them during confirmation', (platform) => {
  const state = setup(platform);
  const modifier = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };
  const shortcuts = [
    { ...modifier, code: 'Digit1', key: '1' },
    { ...modifier, code: 'Digit2', key: '2' },
    { ...modifier, code: 'Digit3', key: '3' },
    { ...modifier, code: 'KeyM', key: 'M', shiftKey: true },
  ];
  for (const shortcut of shortcuts) expect(press(shortcut).defaultPrevented).toBe(true);
  expect(state.openChat).toHaveBeenCalledOnce();
  expect(state.openPullRequests).toHaveBeenCalledOnce();
  expect(state.openAutomation).toHaveBeenCalledOnce();
  expect(state.toggleTheme).toHaveBeenCalledOnce();

  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  document.body.append(modal);
  for (const shortcut of shortcuts) expect(press(shortcut).defaultPrevented).toBe(false);
  modal.remove();
  expect(state.openChat).toHaveBeenCalledOnce();
  expect(state.openPullRequests).toHaveBeenCalledOnce();
  expect(state.openAutomation).toHaveBeenCalledOnce();
  expect(state.toggleTheme).toHaveBeenCalledOnce();

  expect(state.syncBindings).toHaveBeenLastCalledWith(platform === 'darwin'
    ? ['Meta+Digit1', 'Meta+Digit2', 'Meta+Digit3', 'Shift+Meta+KeyM']
    : ['Control+Digit1', 'Control+Digit2', 'Control+Digit3', 'Control+Shift+KeyM']);
  act(() => state.forward({
    altGraph: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    isComposing: false, repeat: false, ...modifier, code: 'Digit3', key: '3',
    source: { kind: 'embedded-browser', tabId: 'tab' },
  }));
  expect(state.openAutomation).toHaveBeenCalledTimes(2);
  document.body.inert = true;
  press({ ...modifier, code: 'Digit1', key: '1' });
  act(() => state.forward({
    altGraph: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    isComposing: false, repeat: false, ...modifier, code: 'Digit3', key: '3',
    source: { kind: 'embedded-browser', tabId: 'tab' },
  }));
  expect(state.openChat).toHaveBeenCalledOnce();
  expect(state.openAutomation).toHaveBeenCalledTimes(2);
  state.unmount();
  expect(state.unsubscribe).toHaveBeenCalledOnce();
  expect(state.syncBindings).toHaveBeenLastCalledWith([]);
});

it('uses user overrides and leaves disabled or conflicting defaults inactive', () => {
  localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify({ version: 1, platforms: { darwin: {
    'app.openChat': [],
    'app.newChat': ['Meta+Digit2'],
    'app.openAutomation': ['Meta+Digit4'],
    'app.toggleTheme': ['Meta+KeyY'],
  } } }));
  const state = setup('darwin');
  expect(press({ code: 'Digit1', metaKey: true }).defaultPrevented).toBe(false);
  expect(press({ code: 'Digit2', metaKey: true }).defaultPrevented).toBe(false);
  expect(press({ code: 'Digit3', metaKey: true }).defaultPrevented).toBe(false);
  expect(press({ code: 'KeyM', metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  expect(state.openChat).not.toHaveBeenCalled();
  expect(state.openPullRequests).not.toHaveBeenCalled();
  expect(state.openAutomation).not.toHaveBeenCalled();
  expect(state.toggleTheme).not.toHaveBeenCalled();
  press({ code: 'KeyY', metaKey: true });
  press({ code: 'Digit4', metaKey: true });
  expect(state.toggleTheme).toHaveBeenCalledOnce();
  expect(state.openAutomation).toHaveBeenCalledOnce();
  expect(state.syncBindings).toHaveBeenLastCalledWith(['Meta+Digit4', 'Meta+KeyY']);
});
