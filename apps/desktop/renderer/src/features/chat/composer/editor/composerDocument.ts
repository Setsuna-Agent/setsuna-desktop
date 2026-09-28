import type { ComposerSlot } from './types.js';

export function slotText(slot: ComposerSlot): string {
  return slot.type === 'text' ? slot.value ?? '' : slot.props.value ?? '';
}

export function readComposerDocument(element: HTMLElement, references: Map<string, ComposerSlot>): ComposerSlot[] {
  const slots: ComposerSlot[] = [];
  const text = (value: string) => {
    if (!value) return;
    const previous = slots.at(-1);
    if (previous?.type === 'text') previous.value = (previous.value ?? '') + value;
    else slots.push({ type: 'text', value });
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { text(node.textContent ?? ''); return; }
    if (!(node instanceof HTMLElement)) return;
    const reference = references.get(node.dataset.slotKey ?? '');
    if (reference) { slots.push(reference); return; }
    if (node.tagName === 'BR') { text('\n'); return; }
    if (['DIV', 'P'].includes(node.tagName) && slots.length && !slotText(slots.at(-1)!).endsWith('\n')) text('\n');
    node.childNodes.forEach(visit);
  };
  element.childNodes.forEach(visit);
  return slots;
}

export function composerRange(element: HTMLElement, position: 'start' | 'end' | 'cursor' = 'cursor'): Range {
  const selection = element.ownerDocument.getSelection();
  const current = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (position === 'cursor' && current && element.contains(current.commonAncestorContainer)) return current.cloneRange();
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(position === 'start');
  return range;
}

export function applyComposerRange(range: Range): void {
  const selection = range.startContainer.ownerDocument?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Scroll only the editor, keeping the surrounding conversation at its reading position. */
export function focusComposerEnd(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  applyComposerRange(composerRange(element, 'end'));
  element.scrollTop = element.scrollHeight;
}

export function isComposerSelectionAtStart(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return false;
  let node: Node | null = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) {
    if (range.startOffset !== 0) return false;
  } else if (Array.from(node.childNodes).slice(0, range.startOffset).some(hasComposerContent)) {
    return false;
  }
  // Empty block siblings still represent preceding lines in contenteditable.
  while (node && node !== element) {
    let previous = node.previousSibling;
    while (previous) {
      if (hasComposerContent(previous)) return false;
      previous = previous.previousSibling;
    }
    node = node.parentNode;
  }
  return true;
}

function hasComposerContent(node: Node): boolean {
  return Boolean(node.textContent)
    || (node instanceof Element && (node.matches('br, div, p, [data-slot-key]')
      || Boolean(node.querySelector('br, div, p, [data-slot-key]'))));
}

/** Only replace a command immediately preceding the caret, never another match. */
export function extendCommandRange(range: Range, element: HTMLElement, command: string): void {
  if (!command || !range.collapsed) return;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  if (!prefix.toString().endsWith(command)) return;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let offset = prefix.toString().length - command.length;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (offset <= length) { range.setStart(node, offset); return; }
    offset -= length;
    node = walker.nextNode();
  }
}

export function composerFragment(document: Document, slots: ComposerSlot[], references: Map<string, ComposerSlot>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const slot of slots) {
    if (slot.type === 'text') fragment.append(document.createTextNode(slot.value ?? ''));
    else {
      references.set(slot.key, slot);
      const tag = document.createElement('span');
      tag.dataset.slotKey = slot.key;
      tag.contentEditable = 'false';
      tag.className = 'chat-prompt__tag';
      // The portal label is display-only. Serialization always reads the slot value.
      tag.textContent = slot.props.value ?? '';
      fragment.append(tag);
    }
  }
  return fragment;
}
