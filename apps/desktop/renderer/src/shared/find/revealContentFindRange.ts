import { pageScaleInverse } from '../lib/zoomedPortalPosition.js';

export function composedParent(element: HTMLElement): HTMLElement | null {
  const root = element.getRootNode();
  return element.parentElement ?? (root instanceof ShadowRoot ? root.host as HTMLElement : null);
}

/** Scroll only the panel's nested viewports, never the app shell. */
export function revealContentFindRange(range: Range, boundary: HTMLElement) {
  let element = range.startContainer.parentElement;
  while (element && element !== boundary) {
    const rect = range.getBoundingClientRect();
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) {
      element.scrollTop += (rect.top - bounds.top) * pageScaleInverse() - (element.clientHeight - rect.height) / 2;
    }
    if (element.scrollWidth > element.clientWidth && (rect.left < bounds.left || rect.right > bounds.right)) {
      element.scrollLeft += (rect.left - bounds.left) * pageScaleInverse() - element.clientWidth / 2;
    }
    element = composedParent(element);
  }
}
