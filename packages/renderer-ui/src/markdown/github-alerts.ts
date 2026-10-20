/** Minimal hast shape; renderer-ui does not depend on `@types/hast` directly. */
type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const ALERT_TITLES = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' } as const;
type AlertKind = keyof typeof ALERT_TITLES;
// GitHub only treats the marker as an alert when it is alone on the blockquote's first line.
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/iu;

/**
 * Renders GitHub `> [!NOTE]` alerts. It must run after sanitizing so only these generated
 * classes reach the DOM and user-authored HTML cannot spoof alert styling.
 */
export function rehypeGitHubAlerts() {
  return (tree: HastNode) => { visit(tree); };
}

function visit(node: HastNode) {
  for (const child of node.children ?? []) {
    if (child.type === 'element' && child.tagName === 'blockquote') convertAlert(child);
    visit(child);
  }
}

function convertAlert(blockquote: HastNode) {
  const children = blockquote.children ?? [];
  const paragraph = children.find((child) => child.type === 'element');
  const text = paragraph?.tagName === 'p' ? paragraph.children?.[0] : undefined;
  const match = text?.type === 'text' ? ALERT_MARKER.exec(text.value ?? '') : null;
  if (!paragraph?.children || !text?.value || !match?.[1]) return;
  const kind = match[1].toLowerCase() as AlertKind;
  text.value = text.value.slice(match[0].length);
  if (!text.value) paragraph.children.shift();
  if (!paragraph.children.length) children.splice(children.indexOf(paragraph), 1);
  blockquote.properties = { ...blockquote.properties, className: ['sd-markdown-alert', `sd-markdown-alert--${kind}`] };
  blockquote.children = [{
    type: 'element', tagName: 'p', properties: { className: ['sd-markdown-alert__title'] },
    children: [{ type: 'text', value: ALERT_TITLES[kind] }],
  }, ...children];
}
