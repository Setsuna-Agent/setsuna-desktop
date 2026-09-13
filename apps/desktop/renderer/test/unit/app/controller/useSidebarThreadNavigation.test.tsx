// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppKeyboardShortcuts } from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import { useSidebarThreadNavigation } from '../../../../src/app/controller/useSidebarThreadNavigation.js';
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcuts,
} from '../../../../src/shared/shortcuts/KeyboardShortcutsProvider.js';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  localStorage.clear();
});

function mountRows() {
  const sidebar = document.createElement('aside');
  sidebar.className = 'desktop-agent-sidebar';
  for (const id of ['a', 'b', 'c']) {
    const row = document.createElement('button');
    row.dataset.sidebarThreadId = id;
    sidebar.append(row);
  }
  document.body.append(sidebar);
  return sidebar;
}

function Shortcuts({ children }: PropsWithChildren) {
  return <KeyboardShortcutsProvider initialPlatform="win32">{children}</KeyboardShortcutsProvider>;
}

async function press(target: HTMLElement, code: string, overrides: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: code, code, altKey: true, bubbles: true, cancelable: true, ...overrides });
  // happy-dom treats Alt alone as AltGraph; real Alt+Arrow events do not.
  Object.defineProperty(event, 'getModifierState', { value: () => false });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

describe('sidebar conversation shortcuts', () => {
  it('serializes pending selection, stays on the current chat after cancellation or failure, and allows retry', async () => {
    mountRows();
    let finishSelection!: () => void;
    const onOpenThread = vi.fn<(id: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishSelection = resolve; }))
      .mockRejectedValueOnce(new Error('Cannot open chat'))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const view = renderHook(() => useSidebarThreadNavigation({
      currentThreadId: 'b', onOpenThread, onError,
    }));

    act(() => {
      view.result.current.goNext();
      view.result.current.goNext();
      view.result.current.goPrevious();
    });
    expect(onOpenThread.mock.calls).toEqual([['c']]);
    // Discard confirmation was cancelled: selection settles without changing the active chat.
    await act(async () => { finishSelection(); });
    await act(async () => { view.result.current.goPrevious(); });
    expect(onError).toHaveBeenCalledWith('Cannot open chat');
    await act(async () => { view.result.current.goPrevious(); });
    expect(onOpenThread.mock.calls).toEqual([['c'], ['a'], ['a']]);
  });

  it('does not intercept ordinary arrows, composition, terminal input, or a modal dialog', async () => {
    const sidebar = mountRows();
    const onOpenThread = vi.fn(async () => undefined);
    const view = renderHook(() => {
      const navigation = useSidebarThreadNavigation({
        currentThreadId: 'a', onOpenThread, onError: vi.fn(),
      });
      useAppKeyboardShortcuts({ 'navigation.nextChat': { execute: navigation.goNext } });
      return useKeyboardShortcuts();
    }, { wrapper: Shortcuts });
    const target = document.createElement('textarea');
    document.body.append(target);
    for (const overrides of [{ altKey: false }, { isComposing: true }, { shiftKey: true }]) {
      expect((await press(target, 'ArrowDown', overrides)).defaultPrevented).toBe(false);
    }
    target.className = 'xterm';
    expect((await press(target, 'ArrowDown')).defaultPrevented).toBe(false);
    target.className = '';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    expect((await press(target, 'ArrowDown')).defaultPrevented).toBe(false);
    expect(onOpenThread).not.toHaveBeenCalled();
    dialog.remove();
    await press(target, 'ArrowDown');
    expect(onOpenThread).toHaveBeenCalledWith('b');
    sidebar.setAttribute('aria-hidden', 'true');
    await press(target, 'ArrowDown');
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    sidebar.removeAttribute('aria-hidden');
    act(() => view.result.current.setBindings('navigation.nextChat', ['Control+KeyJ']));
    expect((await press(target, 'ArrowDown')).defaultPrevented).toBe(false);
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    await press(target, 'KeyJ', { altKey: false, ctrlKey: true });
    expect(onOpenThread).toHaveBeenCalledTimes(2);
  });
});
