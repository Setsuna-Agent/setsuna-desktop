import type { DesktopTextEditCommand } from '@setsuna-desktop/contracts';

export type TextContextMenuTarget = {
  canCopy: boolean;
  editable: boolean;
  restore(command?: DesktopTextEditCommand): boolean;
};

const textInputTypes = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/** Capture before the menu takes focus; native editing needs the original selection. */
export function captureTextContextMenuTarget(event: MouseEvent): TextContextMenuTarget | null {
  const target = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement);
  if (!target) return null;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return captureTextControl(target);

  const editor = target.closest<HTMLElement>('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]');
  if (!editor && target.closest('[role="menu"]')) return null;
  const editable = Boolean(editor && !editor.closest('[aria-disabled="true"]'));
  const selection = target.ownerDocument.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const ownRanges = ranges.filter((range) => editor
    ? editor.contains(range.startContainer) && editor.contains(range.endContainer)
    : range.intersectsNode(target));
  const canCopy = ownRanges.some((range) => range.toString().length > 0);
  if (!editable && !canCopy) return null;
  // An empty editor may be right-clicked before Chromium has installed a caret.
  if (editor && ownRanges.length === 0) {
    const range = target.ownerDocument.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    ownRanges.push(range);
  }
  const selectedText = ownRanges.map((range) => range.toString()).join('');
  return {
    canCopy,
    editable,
    restore(command) {
      if (!target.isConnected || ownRanges.some((range) => !range.startContainer.isConnected || !range.endContainer.isConnected)
        || ownRanges.map((range) => range.toString()).join('') !== selectedText) return false;
      if (command && command !== 'copy' && (!editor?.isContentEditable || editor.closest('[aria-disabled="true"]'))) return false;
      if (editor) editor.focus({ preventScroll: true });
      else {
        const active = target.ownerDocument.activeElement;
        if (active instanceof HTMLElement) active.blur();
        target.closest<HTMLElement>('[tabindex], [role="dialog"]')?.focus({ preventScroll: true });
      }
      selection?.removeAllRanges();
      for (const range of ownRanges) selection?.addRange(range);
      return true;
    },
  };
}

function captureTextControl(control: HTMLInputElement | HTMLTextAreaElement): TextContextMenuTarget | null {
  if (control.matches(':disabled') || (control instanceof HTMLInputElement && !textInputTypes.has(control.type))) return null;
  const start = control.selectionStart;
  const end = control.selectionEnd;
  const direction = control.selectionDirection ?? undefined;
  const value = control.value;
  const password = control instanceof HTMLInputElement && control.type === 'password';
  const canCopy = !password && start !== null && end !== null && end > start;
  const editable = !control.readOnly && !control.closest('[aria-disabled="true"]');
  if (!editable && !canCopy) return null;
  return {
    canCopy,
    editable,
    restore(command) {
      if (!control.isConnected || control.matches(':disabled') || control.value !== value) return false;
      if (command && command !== 'copy' && (control.readOnly || control.closest('[aria-disabled="true"]'))) return false;
      control.focus({ preventScroll: true });
      if (start !== null && end !== null) control.setSelectionRange(start, end, direction);
      return true;
    },
  };
}
