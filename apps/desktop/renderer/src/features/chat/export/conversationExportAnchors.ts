/** Scope one Markdown document without changing independently rendered SVG definitions. */
export function namespaceMarkdownReferences(root: ParentNode, prefix: string): void {
  const ids = new Map<string, string>();
  for (const node of root.querySelectorAll('[id]')) {
    if (node.closest('svg')) continue;
    const original = node.id;
    node.id = `${prefix}-${original}`;
    ids.set(original, node.id);
  }
  if (!ids.size) return;
  for (const node of root.querySelectorAll('*')) {
    if (node.closest('svg')) continue;
    const href = node.getAttribute('href');
    if (href?.startsWith('#')) {
      const target = href.slice(1);
      let id = ids.get(target);
      // GFM can put percent escapes in the ID itself; prefer that exact spelling.
      if (!id) try { id = ids.get(decodeURIComponent(target)); } catch { /* Preserve malformed authored fragments. */ }
      if (id) node.setAttribute('href', `#${encodeURIComponent(id)}`);
    }
    for (const attribute of ['aria-describedby', 'aria-labelledby']) {
      const value = node.getAttribute(attribute);
      if (value) node.setAttribute(attribute, value.split(/\s+/gu).map((id) => ids.get(id) ?? id).join(' '));
    }
  }
}
