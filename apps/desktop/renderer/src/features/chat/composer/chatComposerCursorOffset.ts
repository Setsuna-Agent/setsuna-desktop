export const composerCursorOffsetAdjustmentAttribute = 'data-composer-cursor-offset-adjustment';

type CursorOffsetAdjustment = number | string | null | undefined;

export function composerCursorOffsetAdjustment(serializedText: string, renderedText: string): number {
  return serializedText.length - renderedText.length;
}

export function applyComposerCursorOffsetAdjustments(
  visibleOffset: number,
  adjustments: Iterable<CursorOffsetAdjustment>,
): number {
  let serializedOffset = visibleOffset;
  for (const adjustment of adjustments) {
    const parsedAdjustment = typeof adjustment === 'number'
      ? adjustment
      : typeof adjustment === 'string' && adjustment.trim()
        ? Number(adjustment)
        : Number.NaN;
    if (Number.isFinite(parsedAdjustment)) serializedOffset += parsedAdjustment;
  }
  return Math.max(0, serializedOffset);
}

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
  const visibleOffset = range.toString().length;
  // 提及标签会省略仍保留在提交值中的标记和父路径。
  const offsetAdjustments = Array.from(
    range.cloneContents().querySelectorAll<HTMLElement>(`[${composerCursorOffsetAdjustmentAttribute}]`),
    (element) => element.getAttribute(composerCursorOffsetAdjustmentAttribute),
  );
  return applyComposerCursorOffsetAdjustments(visibleOffset, offsetAdjustments);
}
