import type { BrowserAnnotationTarget } from '../../contracts/annotations.js';

/** Serialized into the isolated world: keep this function self-contained. */
export function readAnnotationElement(element: Element, id: string): BrowserAnnotationTarget {
  const selectorFor = (target: Element): string => {
    const parts: string[] = [];
    let current: Element | null = target;
    while (current && parts.length < 16) {
      let part = current.localName;
      const root = current.getRootNode() as Document | ShadowRoot;
      if (current.id && root.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
        part = `#${CSS.escape(current.id)}`;
        parts.unshift(part);
        if (root instanceof ShadowRoot) {
          parts.unshift('>>>');
          current = root.host;
          continue;
        }
        break;
      }
      part += Array.from(current.classList).slice(0, 4).map((name) => `.${CSS.escape(name)}`).join('');
      const siblings = current.parentElement?.children ?? (root instanceof ShadowRoot ? root.children : undefined);
      if (siblings) {
        const matches = Array.from(siblings).filter((sibling) => sibling.localName === current!.localName);
        if (matches.length > 1) part += `:nth-of-type(${matches.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      if (!current.parentElement && root instanceof ShadowRoot) {
        parts.unshift('>>>');
        current = root.host;
      } else current = current.parentElement;
    }
    return parts.join(' > ').replaceAll(' > >>> > ', ' >>> ').slice(0, 2_000);
  };
  const rect = element.getBoundingClientRect();
  const computed = getComputedStyle(element);
  const properties = ['display', 'position', 'color', 'background-color', 'font-size', 'font-weight',
    'line-height', 'padding', 'margin', 'gap', 'border-radius', 'align-items', 'justify-content'];
  // Never read form values or editable contents; only visible labels belong in feedback.
  const sensitive = element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  let text = '';
  if (!sensitive) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let visited = 0;
    while ((node = walker.nextNode()) && visited++ < 500 && text.length < 500) {
      if (node.parentElement?.closest('script, style, input, textarea, select, [contenteditable]:not([contenteditable="false"])')) continue;
      text += ` ${node.textContent ?? ''}`;
    }
  }
  return {
    id,
    url: location.href,
    title: document.title.slice(0, 300),
    selector: selectorFor(element),
    tag: element.localName,
    text: (element.getAttribute('aria-label') || text).replace(/\s+/g, ' ').trim().slice(0, 500),
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: innerWidth, height: innerHeight },
    styles: Object.fromEntries(properties.map((property) => [property, computed.getPropertyValue(property).slice(0, 200)])),
  };
}
