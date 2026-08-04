import { describe, expect, it, vi } from 'vitest';
import {
  executeDocumentEditCommand,
  type DocumentEditTarget,
} from '../../../../src/shared/lib/documentEditCommand.js';

describe('document edit commands', () => {
  it('restores the original text control and selection before executing a command', () => {
    const focus = vi.fn();
    const setSelectionRange = vi.fn();
    const execCommand = vi.fn(() => true);
    const target = {
      kind: 'text-control',
      element: {
        focus,
        isConnected: true,
        setSelectionRange,
      },
      selectionDirection: 'backward',
      selectionEnd: 8,
      selectionStart: 3,
    } as unknown as DocumentEditTarget;

    expect(executeDocumentEditCommand({ execCommand } as unknown as Document, target, 'copy')).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(setSelectionRange).toHaveBeenCalledWith(3, 8, 'backward');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(execCommand.mock.invocationCallOrder[0] ?? 0);
  });

  it('does not execute against a menu item after the captured editor is removed', () => {
    const execCommand = vi.fn(() => true);
    const target = {
      kind: 'text-control',
      element: { isConnected: false },
    } as unknown as DocumentEditTarget;

    expect(executeDocumentEditCommand({ execCommand } as unknown as Document, target, 'cut')).toBe(false);
    expect(execCommand).not.toHaveBeenCalled();
  });
});
