import { useEffect } from 'react';
import { keyboardEventMatchesBinding } from '../../shared/shortcuts/keyboardShortcutBindings.js';
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (recording || event.repeat || event.isComposing || event.key === 'Process') return;
      const commandId = matchingKeyboardShortcutCommand(event, bindingsFor);
      if (!commandId) return;
      const handler = handlers[commandId];
      if (!handler || handler.enabled === false) return;
      if (hasVisibleModalDialog() && !handler.allowInModal) return;
      if (isTerminalEventTarget(event.target) && !handler.allowInTerminal) return;

      event.preventDefault();
      event.stopPropagation();
      handler.execute();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [bindingsFor, handlers, recording]);
}

export function matchingKeyboardShortcutCommand(
  event: KeyboardEvent,
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
    && Boolean(target.closest('.desktop-terminal-xterm, .xterm'));
}
