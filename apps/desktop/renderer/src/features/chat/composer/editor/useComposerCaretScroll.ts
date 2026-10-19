import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { isComposerSelectionAtEnd } from './composerDocument.js';

/** Reveal the resulting caret after React commits pasted reference labels and editor sizing. */
export function useComposerCaretScroll(elementRef: RefObject<HTMLElement | null>): () => void {
  const frameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  return useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const element = elementRef.current;
      if (!element?.isConnected || element.ownerDocument.activeElement !== element) return;
      scrollComposerCaretIntoView(element);
    });
  }, [elementRef]);
}

function scrollComposerCaretIntoView(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount || !selection.focusNode
    || !element.contains(selection.focusNode)) return;

  // A trailing blank line has no Range rectangles in Chromium. The editor's
  // scroll extent still includes it, so end-of-input carets need no measurement.
  if (isComposerSelectionAtEnd(element)) {
    element.scrollTop = element.scrollHeight;
    return;
  }

  const caret = selection.getRangeAt(0).cloneRange();
  // DOM insertion can leave the caret between text nodes. Measure the adjacent
  // text boundary without moving the real selection or changing the undo history.
  if (caret.startContainer.nodeType !== Node.TEXT_NODE) {
    const next = caret.startContainer.childNodes[caret.startOffset];
    const previous = caret.startContainer.childNodes[caret.startOffset - 1];
    const adjacent = next ?? previous;
    if (adjacent) {
      caret.selectNodeContents(adjacent);
      caret.collapse(Boolean(next));
    }
  }
  let rect = caret.getClientRects()[0];
  // Blank lines inside the draft also have no collapsed-range bounds. Selecting
  // their next character in this measurement-only range exposes the line box.
  if (!rect?.height && caret.startContainer.nodeType === Node.TEXT_NODE
    && caret.startOffset < (caret.startContainer.textContent?.length ?? 0)) {
    caret.setEnd(caret.startContainer, caret.startOffset + 1);
    rect = caret.getClientRects()[0];
  }
  if (!rect?.height) return;

  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const viewportTop = element.getBoundingClientRect().top + element.clientTop;
  const visibleTop = viewportTop + (Number.parseFloat(style?.paddingTop ?? '') || 0);
  const visibleBottom = viewportTop + element.clientHeight - (Number.parseFloat(style?.paddingBottom ?? '') || 0);
  // Only scroll the input; scrollIntoView would also move the surrounding chat.
  if (rect.top < visibleTop) element.scrollTop += rect.top - visibleTop;
  else if (rect.bottom > visibleBottom) element.scrollTop += rect.bottom - visibleBottom;
}
