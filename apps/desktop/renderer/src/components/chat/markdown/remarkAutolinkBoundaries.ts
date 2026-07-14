type MarkdownPosition = {
  end: { offset?: number };
  start: { offset?: number };
};

type MarkdownNode = {
  children?: MarkdownNode[];
  position?: MarkdownPosition;
  type: string;
  url?: string;
  value?: string;
  [key: string]: unknown;
};

type MarkdownParent = MarkdownNode & { children: MarkdownNode[] };

type MarkdownFile = {
  value?: unknown;
};

const eastAsianPunctuationPattern = /[\u2010-\u2027\u3000-\u303f\ufe10-\ufe1f\ufe30-\ufe4f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/u;

const pairedInlineMarkers = [
  { marker: '**', type: 'strong' },
  { marker: '__', type: 'strong' },
  { marker: '~~', type: 'delete' },
  { marker: '*', type: 'emphasis' },
  { marker: '_', type: 'emphasis' },
] as const;

/**
 * GFM bare autolinks do not treat Chinese punctuation as a URL boundary. That can
 * make one URL consume the rest of a Chinese paragraph, including closing
 * emphasis markers. Repair only parser-created literal links; explicit Markdown
 * links and angle-bracket autolinks keep their author-defined boundaries.
 */
export function remarkAutolinkBoundaries() {
  return (tree: unknown, file: MarkdownFile): void => {
    if (!isMarkdownParent(tree) || typeof file.value !== 'string') return;
    rewriteAutolinks(tree, file.value);
  };
}

function rewriteAutolinks(parent: MarkdownParent, source: string): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index];
    if (rewriteLiteralAutolink(parent, index, source)) continue;
    if (isMarkdownParent(child)) rewriteAutolinks(child, source);
  }
}

function rewriteLiteralAutolink(parent: MarkdownParent, index: number, source: string): boolean {
  const link = parent.children[index];
  const linkText = literalAutolinkText(link, source);
  if (!linkText) return false;

  const punctuationIndex = linkText.search(eastAsianPunctuationPattern);
  if (punctuationIndex < 0) return false;

  const previous = parent.children[index - 1];
  const rawUrl = linkText.slice(0, punctuationIndex);
  const suffix = linkText.slice(punctuationIndex);
  const pairedMarker = findPairedMarker(previous, rawUrl);
  const url = pairedMarker ? rawUrl.slice(0, -pairedMarker.marker.length) : rawUrl;
  if (!isValidHttpUrl(url)) return false;

  const normalizedLink: MarkdownNode = {
    ...link,
    children: [{ type: 'text', value: url }],
    position: undefined,
    url,
  };
  const normalizedContent: MarkdownNode = pairedMarker
    ? { children: [normalizedLink], type: pairedMarker.type }
    : normalizedLink;
  const replacement = [normalizedContent, { type: 'text', value: suffix } satisfies MarkdownNode];

  if (pairedMarker && previous?.type === 'text' && typeof previous.value === 'string') {
    const precedingText = previous.value.slice(0, -pairedMarker.marker.length);
    if (precedingText) {
      previous.value = precedingText;
      parent.children.splice(index, 1, ...replacement);
    } else {
      parent.children.splice(index - 1, 2, ...replacement);
    }
    return true;
  }

  parent.children.splice(index, 1, ...replacement);
  return true;
}

function literalAutolinkText(node: MarkdownNode, source: string): string | null {
  if (node.type !== 'link' || typeof node.url !== 'string' || !/^https?:\/\//i.test(node.url)) return null;
  if (!isMarkdownParent(node) || node.children.length !== 1) return null;

  const textNode = node.children[0];
  if (textNode.type !== 'text' || typeof textNode.value !== 'string' || textNode.value !== node.url) return null;

  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== 'number' || typeof end !== 'number') return null;

  // `[label](url)` and `<url>` include delimiters in the source slice; a GFM
  // literal autolink does not. This keeps explicit author intent untouched.
  return source.slice(start, end) === textNode.value ? textNode.value : null;
}

function findPairedMarker(previous: MarkdownNode | undefined, rawUrl: string) {
  if (previous?.type !== 'text' || typeof previous.value !== 'string') return null;
  return pairedInlineMarkers.find(
    ({ marker }) => previous.value?.endsWith(marker) && rawUrl.endsWith(marker),
  ) ?? null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isMarkdownParent(value: unknown): value is MarkdownParent {
  return isMarkdownNode(value) && Array.isArray(value.children) && value.children.every(isMarkdownNode);
}

function isMarkdownNode(value: unknown): value is MarkdownNode {
  return Boolean(value) && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}
