import { describe, expect, it } from 'vitest';
import {
  activeKeyboardShortcutBindings,
  browserShortcutTabId,
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

describe('activeKeyboardShortcutBindings', () => {
  it('syncs only bindings whose commands can currently execute', () => {
    const handlers = {
      'app.newChat': { execute: () => undefined },
      'app.openSettings': { enabled: false, execute: () => undefined },
      'browser.reload': { execute: () => undefined },
    } as const;

    expect(activeKeyboardShortcutBindings(
      handlers,
      (commandId) => {
        if (commandId === 'app.newChat') return ['Control+KeyN'];
        if (commandId === 'browser.reload') return ['Control+KeyR'];
        return ['Control+Comma'];
      },
    )).toEqual(['Control+KeyN', 'Control+KeyR']);
  });
});

describe('browserShortcutTabId', () => {
  it('uses the browser tab that forwarded the shortcut instead of another active surface', () => {
    expect(browserShortcutTabId({
      ...keyEvent({ code: 'KeyR', ctrlKey: true, key: 'r' }),
      source: { kind: 'embedded-browser', tabId: 'bottom-browser' },
    }, 'side-browser')).toBe('bottom-browser');
  });

  it('does not guess another tab when an embedded browser has not registered its source yet', () => {
    expect(browserShortcutTabId({
      ...keyEvent({ code: 'KeyR', ctrlKey: true, key: 'r' }),
      source: { kind: 'embedded-browser', tabId: null },
    }, 'side-browser')).toBeNull();
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
