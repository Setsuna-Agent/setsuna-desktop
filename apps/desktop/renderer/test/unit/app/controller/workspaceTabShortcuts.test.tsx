// @vitest-environment happy-dom
import type { DesktopKeyboardShortcutInput } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { workspaceTabShortcutHandlers } from '../../../../src/app/controller/workspaceTabShortcuts.js';
import { KeyboardShortcutsProvider, KEYBOARD_SHORTCUTS_STORAGE_KEY, useKeyboardShortcuts } from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';
import type { KeyboardShortcutPlatform } from '../../../../src/shared/shortcuts/keyboardShortcutCommands.js';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.body.inert = false;
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each([
  ['darwin', 'side'], ['darwin', 'bottom'], ['win32', 'side'], ['win32', 'bottom'],
] as const)('closes and adds tabs from a focused %s terminal in the %s slot without sending the keys to the shell', (platform, slot) => {
  const state = setup(platform);
  const input = terminalInput(slot);
  const shellKey = vi.fn();
  input.addEventListener('keydown', shellKey);
  const modifier = platform === 'darwin' ? { metaKey: true } : { ctrlKey: true };

  expect(press(input, { ...modifier, key: 'w', code: 'KeyW' }).defaultPrevented).toBe(true);
  if (slot === 'side') {
    expect(state.closeSidePanel).toHaveBeenCalledOnce();
    expect(state.closePanel).not.toHaveBeenCalled();
  } else {
    expect(state.closePanel).toHaveBeenCalledExactlyOnceWith('bottom', 'bottom-tab');
    expect(state.closeSidePanel).not.toHaveBeenCalled();
  }
  expect(press(input, { ...modifier, shiftKey: true, key: 'T', code: 'KeyT' }).defaultPrevented).toBe(true);
  expect(state.openPanel).toHaveBeenCalledExactlyOnceWith(slot, slot === 'side' ? 'overview' : 'terminal');
  expect(shellKey).not.toHaveBeenCalled();

  expect(press(input, { ctrlKey: true, key: 'c', code: 'KeyC' }).defaultPrevented).toBe(false);
  expect(press(input, { ...modifier, key: 'n', code: 'KeyN' }).defaultPrevented).toBe(false);
  expect(state.newChat).not.toHaveBeenCalled();
  expect(shellKey).toHaveBeenCalledTimes(2);
});

it('honors existing close overrides and custom add bindings while retaining modal, recording, and disabled guards', () => {
  localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify({ version: 1, platforms: { darwin: {
    'workspace.closeActiveSidePanel': ['Shift+Meta+KeyY'],
    'workspace.addPanel': ['Shift+Meta+KeyU'],
  } } }));
  const state = setup('darwin');
  const input = terminalInput('bottom');
  const close = { metaKey: true, shiftKey: true, key: 'Y', code: 'KeyY' };
  const add = { metaKey: true, shiftKey: true, key: 'U', code: 'KeyU' };
  expect(press(input, { metaKey: true, code: 'KeyW' }).defaultPrevented).toBe(false);
  expect(press(input, { metaKey: true, shiftKey: true, code: 'KeyT' }).defaultPrevented).toBe(false);
  expect(press(input, close).defaultPrevented).toBe(true);
  expect(press(input, add).defaultPrevented).toBe(true);
  expect(state.closePanel).toHaveBeenCalledOnce();
  expect(state.openPanel).toHaveBeenCalledOnce();

  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  document.body.append(modal);
  expect(press(input, close).defaultPrevented).toBe(false);
  expect(press(input, add).defaultPrevented).toBe(false);
  modal.remove();
  act(() => state.result.current.setRecording(true));
  expect(press(input, close).defaultPrevented).toBe(false);
  expect(press(input, add).defaultPrevented).toBe(false);
  act(() => state.result.current.setRecording(false));
  state.rerender({ enabled: false, bottomPanelVisible: true });
  expect(press(input, close).defaultPrevented).toBe(false);
  expect(press(input, add).defaultPrevented).toBe(false);
  expect(state.closePanel).toHaveBeenCalledOnce();
  expect(state.openPanel).toHaveBeenCalledOnce();
});

it('routes forwarded browser keys to their slot and ignores missing sources and hidden bottom tabs', () => {
  const state = setup('darwin');
  state.forwardClose(null);
  state.forwardClose('missing');
  expect(state.closeSidePanel).not.toHaveBeenCalled();
  expect(state.closePanel).not.toHaveBeenCalled();
  state.forwardClose('bottom-tab');
  expect(state.closePanel).toHaveBeenCalledExactlyOnceWith('bottom', 'bottom-tab');
  state.forwardClose('side-tab');
  expect(state.closeSidePanel).toHaveBeenCalledOnce();
  state.rerender({ enabled: true, bottomPanelVisible: false });
  state.forwardClose('bottom-tab');
  expect(state.closePanel).toHaveBeenCalledOnce();
  expect(state.closeSidePanel).toHaveBeenCalledOnce();
});

function setup(platform: KeyboardShortcutPlatform) {
  let forward!: (event: DesktopKeyboardShortcutInput) => void;
  vi.stubGlobal('setsunaDesktop', { desktop: {
    platform,
    onKeyboardShortcutInput: (listener: typeof forward) => { forward = listener; return () => undefined; },
    setActiveKeyboardShortcutBindings: vi.fn(async () => true),
  } });
  const closeSidePanel = vi.fn();
  const closePanel = vi.fn();
  const openPanel = vi.fn();
  const newChat = vi.fn();
  const view = renderHook(({ enabled, bottomPanelVisible }) => {
    const shortcuts = useKeyboardShortcuts();
    useAppKeyboardShortcuts({
      ...workspaceTabShortcutHandlers({ enabled, bottomPanelVisible, bottomActivePanelId: 'bottom-tab',
        sidePanels: [{ id: 'side-tab' }], bottomPanels: [{ id: 'bottom-tab' }], closeSidePanel, closePanel, openPanel }),
      'app.newChat': { execute: newChat },
    });
    return shortcuts;
  }, {
    initialProps: { enabled: true, bottomPanelVisible: true },
    wrapper: ({ children }: { children: ReactNode }) => <KeyboardShortcutsProvider initialPlatform={platform}>{children}</KeyboardShortcutsProvider>,
  });
  return { ...view, closeSidePanel, closePanel, openPanel, newChat,
    forwardClose: (tabId: string | null) => act(() => forward({
      code: 'KeyW', key: 'w', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false,
      altGraph: false, isComposing: false, repeat: false, source: { kind: 'embedded-browser', tabId },
    })),
  };
}

function terminalInput(slot: 'side' | 'bottom') {
  const container = document.createElement('section');
  container.setAttribute('data-workspace-panel-slot', slot);
  const terminal = document.createElement('div');
  terminal.setAttribute('data-feature-id', 'terminal');
  const input = document.createElement('textarea');
  terminal.append(input);
  container.append(terminal);
  document.body.append(container);
  input.focus();
  return input;
}

function press(target: HTMLElement, input: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...input });
  act(() => { target.dispatchEvent(event); });
  return event;
}
