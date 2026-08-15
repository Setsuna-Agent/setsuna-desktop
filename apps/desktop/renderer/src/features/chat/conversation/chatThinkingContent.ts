import { splitThinkTaggedText, visibleTextOutsideThinkTags } from '@setsuna-desktop/contracts';

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

export function hasThinkingSegments(content: string): boolean {
  return splitThinkingContent(content).some((segment) => segment.type === 'think' && Boolean(segment.content.trim()));
}

export function hasRenderableThinkingContent(content: string, streaming: boolean): boolean {
  return splitThinkingContent(content, streaming).some((segment) => {
    if (segment.type === 'markdown') return Boolean(segment.content.trim());
    return streaming && !segment.closed && Boolean(segment.content.trim());
  });
}
