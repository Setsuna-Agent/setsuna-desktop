import type { DesktopKeyboardShortcutInput } from '@setsuna-desktop/contracts';
import { useEffect } from 'react';
import {
  keyboardEventMatchesBinding,
  type KeyboardShortcutEvent,
} from '../../shared/shortcuts/keyboardShortcutBindings.js';
import {
  keyboardShortcutCommands,
  type KeyboardShortcutCommandId,
} from '../../shared/shortcuts/keyboardShortcutCommands.js';
import { useKeyboardShortcuts } from '../../shared/shortcuts/KeyboardShortcutsProvider.js';

export type AppKeyboardShortcutHandler = {
  enabled?: boolean;
  allowInModal?: boolean;
  allowInTerminal?: boolean;
  execute: () => void;
};

export type AppKeyboardShortcutHandlers = Partial<
  Record<KeyboardShortcutCommandId, AppKeyboardShortcutHandler>
>;

export function useAppKeyboardShortcuts(handlers: AppKeyboardShortcutHandlers): void {
  const { bindingsFor, recording } = useKeyboardShortcuts();

  useEffect(() => {
    const executeShortcut = (event: KeyboardEvent | DesktopKeyboardShortcutInput) => {
      if (recording || event.repeat || event.isComposing || event.key === 'Process') return;
      const commandId = matchingKeyboardShortcutCommand(event, bindingsFor);
      if (!commandId) return;
      const handler = handlers[commandId];
      if (!handler || handler.enabled === false) return;
      if (hasVisibleModalDialog() && !handler.allowInModal) return;
      const target = 'target' in event ? event.target : null;
      if (isTerminalEventTarget(target) && !handler.allowInTerminal) return;

      if ('preventDefault' in event) event.preventDefault();
      if ('stopPropagation' in event) event.stopPropagation();
      handler.execute();
    };
    const handleKeyDown = (event: KeyboardEvent) => executeShortcut(event);

    window.addEventListener('keydown', handleKeyDown, true);
    const unsubscribe = window.setsunaDesktop?.desktop.onKeyboardShortcutInput(executeShortcut);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      unsubscribe?.();
    };
  }, [bindingsFor, handlers, recording]);

  useEffect(() => {
    const setActiveBindings = window.setsunaDesktop?.desktop.setActiveKeyboardShortcutBindings;
    if (!setActiveBindings) return undefined;
    const activeBindings = recording ? [] : activeKeyboardShortcutBindings(handlers, bindingsFor);
    void setActiveBindings(activeBindings).catch(() => undefined);
    return () => { void setActiveBindings([]).catch(() => undefined); };
  }, [bindingsFor, handlers, recording]);
}

export function activeKeyboardShortcutBindings(
  handlers: AppKeyboardShortcutHandlers,
  bindingsFor: (commandId: KeyboardShortcutCommandId) => readonly string[],
): string[] {
  return [...new Set(keyboardShortcutCommands.flatMap((command) => {
    const handler = handlers[command.id];
    return handler && handler.enabled !== false ? bindingsFor(command.id) : [];
  }))];
}

export function matchingKeyboardShortcutCommand(
  event: KeyboardShortcutEvent,
  bindingsFor: (commandId: KeyboardShortcutCommandId) => readonly string[],
): KeyboardShortcutCommandId | null {
  for (const command of keyboardShortcutCommands) {
    if (bindingsFor(command.id).some((binding) => keyboardEventMatchesBinding(event, binding))) {
      return command.id;
    }
  }
  return null;
}

export function isModalDialogVisible(
  dialog: HTMLElement,
  readStyle: (element: Element) => Pick<CSSStyleDeclaration, 'display' | 'visibility'> = (element) => window.getComputedStyle(element),
): boolean {
  let current: HTMLElement | null = dialog;
  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = readStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    current = current.parentElement;
  }
  return true;
}

function hasVisibleModalDialog(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
    .some((dialog) => isModalDialogVisible(dialog));
}

function isTerminalEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('[data-feature-id="terminal"], .xterm'));
}
