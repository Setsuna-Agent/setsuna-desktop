import { describe, expect, it } from 'vitest';
import {
  isModalDialogVisible,
  matchingKeyboardShortcutCommand,
} from '../../../../src/app/controller/useAppKeyboardShortcuts.js';
import type { KeyboardShortcutCommandId } from '../../../../src/shared/shortcuts/keyboardShortcutCommands.js';

describe('matchingKeyboardShortcutCommand', () => {
  it('resolves a configured binding to its command', () => {
    const bindings = new Map<KeyboardShortcutCommandId, readonly string[]>([
      ['app.newChat', ['Control+Alt+KeyJ']],
    ]);

    expect(matchingKeyboardShortcutCommand(
      keyEvent({ altKey: true, code: 'KeyJ', ctrlKey: true }),
      (commandId) => bindings.get(commandId) ?? [],
    )).toBe('app.newChat');
  });

  it('does not match a partial modifier combination', () => {
    expect(matchingKeyboardShortcutCommand(
      keyEvent({ code: 'KeyJ', ctrlKey: true, shiftKey: true }),
      (commandId) => commandId === 'app.newChat' ? ['Control+KeyJ'] : [],
    )).toBeNull();
  });
});

describe('isModalDialogVisible', () => {
  it('ignores dialogs retained inside a hidden modal container', () => {
    const hiddenContainer = modalElement({ display: 'none' });
    const dialog = modalElement({ parentElement: hiddenContainer });

    expect(isModalDialogVisible(dialog, readModalStyle)).toBe(false);
  });

  it('recognizes a dialog whose ancestor chain is visible', () => {
    const container = modalElement();
    const dialog = modalElement({ parentElement: container });

    expect(isModalDialogVisible(dialog, readModalStyle)).toBe(true);
  });
});

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    code: '',
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

type ModalElement = HTMLElement & { testDisplay: string; testVisibility: string };

function modalElement({
  display = 'block',
  hidden = false,
  parentElement = null,
  visibility = 'visible',
}: {
  display?: string;
  hidden?: boolean;
  parentElement?: HTMLElement | null;
  visibility?: string;
} = {}): ModalElement {
  return {
    getAttribute: () => null,
    hidden,
    parentElement,
    testDisplay: display,
    testVisibility: visibility,
  } as unknown as ModalElement;
}

function readModalStyle(element: Element): Pick<CSSStyleDeclaration, 'display' | 'visibility'> {
  const modal = element as ModalElement;
  return { display: modal.testDisplay, visibility: modal.testVisibility };
}
