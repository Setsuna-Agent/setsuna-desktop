/** Measure the caret without inserting DOM markers that would disturb native undo. */
export function composerCaretRect(element: HTMLElement | null): DOMRect {
  if (!element) return new DOMRect();
  const selection = element.ownerDocument.getSelection();
  if (selection?.isCollapsed && selection.rangeCount && selection.focusNode
    && element.contains(selection.focusNode)) {
    const caret = selection.getRangeAt(0).cloneRange();
    if (caret.startContainer.nodeType !== Node.TEXT_NODE) {
      const next = caret.startContainer.childNodes[caret.startOffset];
      const previous = caret.startContainer.childNodes[caret.startOffset - 1];
      if (next || previous) {
        caret.selectNodeContents(next ?? previous);
        caret.collapse(Boolean(next));
      }
    }
    const rect = caret.getClientRects?.()[0];
    if (rect?.height) return new DOMRect(rect.left, rect.top, 0, rect.height);

    // Chromium may omit collapsed ranges at text boundaries. The preceding
    // trigger/query character still exposes the insertion point's line box.
    if (caret.startContainer.nodeType === Node.TEXT_NODE && caret.startOffset > 0) {
      caret.setStart(caret.startContainer, caret.startOffset - 1);
      const rects = caret.getClientRects?.();
      const previousRect = rects?.[rects.length - 1];
      if (previousRect?.height) return new DOMRect(previousRect.right, previousRect.top, 0, previousRect.height);
    }
  }

  // The command button can open the menu before an empty editor has a selection.
  const bounds = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const scale = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
  return new DOMRect(
    bounds.left + (Number.parseFloat(style?.paddingLeft ?? '') || 0) * scale,
    bounds.top + (Number.parseFloat(style?.paddingTop ?? '') || 0) * scale,
    0,
    (Number.parseFloat(style?.lineHeight ?? '') || 20) * scale,
  );
}
