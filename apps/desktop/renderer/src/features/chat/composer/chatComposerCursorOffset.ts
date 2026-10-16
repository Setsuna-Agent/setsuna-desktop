export function readComposerCursorOffset(inputElement?: HTMLElement | null): number | null {
  if (!inputElement) return null;
  const ownerWindow = inputElement.ownerDocument.defaultView;
  if (
    ownerWindow
    && (inputElement instanceof ownerWindow.HTMLTextAreaElement || inputElement instanceof ownerWindow.HTMLInputElement)
  ) {
    return inputElement.selectionStart ?? null;
  }

  const selection = inputElement.ownerDocument.getSelection();
  if (!selection?.focusNode || selection.rangeCount === 0 || !inputElement.contains(selection.focusNode)) return null;
  const range = inputElement.ownerDocument.createRange();
  range.selectNodeContents(inputElement);
  range.setEnd(selection.focusNode, selection.focusOffset);
  let offset = range.toString().length;
  // Count each atomic reference by its stored value, independent of label shortening,
  // app renames, icons, or whether its React portal has committed yet.
  for (const tag of range.cloneContents().querySelectorAll<HTMLElement>('[data-slot-key][data-composer-value-length]')) {
    const length = Number(tag.dataset.composerValueLength);
    if (Number.isFinite(length) && length >= 0) offset += length - (tag.textContent?.length ?? 0);
  }
  return Math.max(0, offset);
}
