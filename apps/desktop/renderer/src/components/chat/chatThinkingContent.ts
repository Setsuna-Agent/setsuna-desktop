export type ChatThinkingSegment = {
  closed: boolean;
  content: string;
  type: 'markdown' | 'think';
};

export function splitThinkingContent(content: string): ChatThinkingSegment[] {
  const segments: ChatThinkingSegment[] = [];
  const tagRegex = /<\/?think(?:\s[^>]*)?>|&lt;\/?think(?:\s[^&]*)?&gt;/gi;
  let mode: ChatThinkingSegment['type'] = 'markdown';
  let segmentStart = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[0].toLowerCase();

    if (tag.startsWith('</') || tag.startsWith('&lt;/')) {
      if (mode === 'think') {
        segments.push({ type: 'think', content: content.slice(segmentStart, match.index), closed: true });
        mode = 'markdown';
        segmentStart = tagRegex.lastIndex;
      }
      continue;
    }

    if (mode === 'markdown') {
      segments.push({ type: 'markdown', content: content.slice(segmentStart, match.index), closed: true });
      mode = 'think';
      segmentStart = tagRegex.lastIndex;
    }
  }

  segments.push({ type: mode, content: content.slice(segmentStart), closed: mode === 'markdown' });
  return segments.filter((segment) => segment.type === 'think' || segment.content.trim());
}

export function visibleMarkdownContent(content: string): string {
  return splitThinkingContent(content)
    .filter((segment) => segment.type === 'markdown')
    .map((segment) => segment.content)
    .join('');
}

export function hasThinkingSegments(content: string): boolean {
  return splitThinkingContent(content).some((segment) => segment.type === 'think' && Boolean(segment.content.trim()));
}

export function hasRenderableThinkingContent(content: string, streaming: boolean): boolean {
  return splitThinkingContent(content).some((segment) => {
    if (segment.type === 'markdown') return Boolean(segment.content.trim());
    return streaming && !segment.closed && Boolean(segment.content.trim());
  });
}
