import {
  splitThinkTaggedText,
  thinkTagMatches,
  visibleTextOutsideThinkTags,
} from '@setsuna-desktop/contracts';

export type ChatThinkingSegment = {
  closed: boolean;
  content: string;
  type: 'markdown' | 'think';
};

export function splitThinkingContent(content: string, streaming = false): ChatThinkingSegment[] {
  return splitThinkTaggedText(content, { legacyStreaming: streaming })
    .filter((segment) => segment.type === 'think' || segment.content.trim());
}

export function visibleMarkdownContent(content: string): string {
  return visibleTextOutsideThinkTags(content);
}

/** Keeps authoritative protocol examples visible while the Markdown renderer still drops HTML. */
export function literalThinkTagsForMarkdown(content: string): string {
  const chunks: string[] = [];
  let cursor = 0;
  for (const match of thinkTagMatches(content)) {
    if (content[match.index] !== '<') continue;
    chunks.push(
      content.slice(cursor, match.index),
      `&lt;${content.slice(match.index + 1, match.end - 1)}&gt;`,
    );
    cursor = match.end;
  }
  if (!chunks.length) return content;
  chunks.push(content.slice(cursor));
  return chunks.join('');
}

export function hasThinkingSegments(content: string): boolean {
  return splitThinkingContent(content).some((segment) => segment.type === 'think' && Boolean(segment.content.trim()));
}

export function hasRenderableThinkingContent(content: string, streaming: boolean): boolean {
  return splitThinkingContent(content, streaming).some((segment) => {
    if (segment.type === 'markdown') return Boolean(segment.content.trim());
    return streaming && !segment.closed && Boolean(segment.content.trim());
  });
}
