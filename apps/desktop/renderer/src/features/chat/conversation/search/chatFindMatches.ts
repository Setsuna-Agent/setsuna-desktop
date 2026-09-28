const excludedElements = 'script, style, noscript, svg, button, input, textarea, select, [contenteditable="true"], [hidden], [aria-hidden="true"]';

type TextPart = { node: Text; start: number; end: number };

/** Search rendered text without inserting marks into React-owned message nodes. */
export function findChatTextRanges(root: HTMLElement, query: string, onShadowRoot?: (root: ShadowRoot) => void): Range[] {
  if (!query) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const ranges: Range[] = [];
  let text = '';
  let parts: TextPart[] = [];

  const flush = () => {
    // Inline formatting may split one match across several text nodes. Block
    // boundaries must still prevent matches spanning unrelated messages/rows.
    let partIndex = 0;
    for (const match of text.matchAll(expression)) {
      const start = match.index;
      const end = start + match[0].length;
      while (parts[partIndex].end <= start) partIndex += 1;
      const first = parts[partIndex];
      let lastIndex = partIndex;
      while (parts[lastIndex].end < end) lastIndex += 1;
      const last = parts[lastIndex];
      const range = root.ownerDocument.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      ranges.push(range);
    }
    text = '';
    parts = [];
  };

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '';
      if (value) {
        parts.push({ node: node as Text, start: text.length, end: text.length + value.length });
        text += value;
      }
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(excludedElements)) { flush(); return; }
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      flush();
      return;
    }
    const block = node.tagName === 'BR' || !(style.display.startsWith('inline') || style.display === 'contents');
    if (block) flush();
    // Closed details expose their summary only; searching hidden tool output
    // would count results that the user cannot navigate to.
    if (node.shadowRoot) {
      flush();
      onShadowRoot?.(node.shadowRoot);
      for (const child of node.shadowRoot.childNodes) visit(child);
      flush();
      return;
    }
    const children = node instanceof HTMLDetailsElement && !node.open
      ? Array.from(node.children).filter((child) => child.tagName === 'SUMMARY').slice(0, 1)
      : node instanceof HTMLSlotElement ? node.assignedNodes({ flatten: true }) : node.childNodes;
    for (const child of children) visit(child);
    if (block) flush();
  };

  visit(root);
  flush();
  return ranges;
}
