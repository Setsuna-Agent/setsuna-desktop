type TextEditElement = HTMLInputElement | HTMLTextAreaElement;

export type DocumentEditTarget =
  | {
      kind: 'text-control';
      element: TextEditElement;
      selectionDirection: TextEditElement['selectionDirection'];
      selectionEnd: number | null;
      selectionStart: number | null;
    }
  | {
      kind: 'content-editable';
      element: HTMLElement;
      range: Range | null;
    };

/** Capture the editor and its selection before an accessible menu moves focus. */
export function captureDocumentEditTarget(element: Element | null): DocumentEditTarget | null {
  const view = element?.ownerDocument.defaultView;
  if (!element || !view) return null;
  if (element instanceof view.HTMLInputElement || element instanceof view.HTMLTextAreaElement) {
    return {
      kind: 'text-control',
      element,
      selectionDirection: element.selectionDirection,
      selectionEnd: element.selectionEnd,
      selectionStart: element.selectionStart,
    };
  }
  if (!(element instanceof view.HTMLElement) || !element.isContentEditable) return null;

  const selection = element.ownerDocument.getSelection();
  const selectedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  return {
    kind: 'content-editable',
    element,
    range: selectedRange && element.contains(selectedRange.commonAncestorContainer)
      ? selectedRange.cloneRange()
      : null,
  };
}

export function executeDocumentEditCommand(
  document: Document,
  target: DocumentEditTarget | null,
  command: string,
): boolean {
  if (target && !target.element.isConnected) return false;
  if (target) restoreDocumentEditTarget(document, target);
  return document.execCommand(command);
}

function restoreDocumentEditTarget(document: Document, target: DocumentEditTarget): void {
  target.element.focus({ preventScroll: true });
  if (target.kind === 'text-control') {
    if (target.selectionStart !== null && target.selectionEnd !== null) {
      target.element.setSelectionRange(
        target.selectionStart,
        target.selectionEnd,
        target.selectionDirection ?? undefined,
      );
    }
    return;
  }

  if (!target.range) return;
  const selection = document.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(target.range);
}
