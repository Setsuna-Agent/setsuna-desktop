import { chatDisplayItemRenderKey, type ChatDisplayItem } from '../chatMessageDisplay.js';
import { visibleMarkdownContent } from '../chatThinkingContent.js';

export type ChatMessageNavigationItem = {
  id: string;
  role: 'user' | 'assistant';
  label: string;
  description: string;
};

/** Use transcript identities, not streamed text or segment counts, to anchor navigation. */
export function createChatMessageNavigation(items: ChatDisplayItem[]): ChatMessageNavigationItem[] {
  const messages = items.flatMap((item): ChatMessageNavigationItem[] => {
    if (item.type !== 'user' && item.type !== 'assistant') return [];
    let content: string;
    if (item.type === 'user') {
      content = item.message.content || item.message.attachments?.map((attachment) => attachment.name).join(', ') || '';
    } else {
      const finalSegments = item.segments.filter((segment) => segment.phase === 'final_answer');
      const segments = finalSegments.length ? finalSegments : item.segments;
      content = item.reviewExit?.review ?? segments.map((segment) => (
        segment.streamParts === undefined ? visibleMarkdownContent(segment.content) : segment.content
      )).join('\n');
    }
    const text = content
      .replace(/!?\[([^\]]+)\]\([^\n)]*\)/g, '$1')
      .replace(/(?:^|\n)\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/g, ' ')
      .replace(/(`+)([^`]+)\1/g, '$2')
      .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
      .replace(/\s+/g, ' ')
      .trim();
    return [{
      id: chatDisplayItemRenderKey(item),
      role: item.type,
      label: excerpt(text, 56),
      description: excerpt(text, 144),
    }];
  });
  return messages.map((item, index) => ({
    ...item,
    description: item.role === 'user' && messages[index + 1]?.role === 'assistant'
      ? messages[index + 1].description
      : item.description,
  }));
}

function excerpt(text: string, length: number): string {
  const characters = Array.from(text.slice(0, length * 2 + 1));
  return characters.length > length ? `${characters.slice(0, length).join('')}…` : text;
}

export type ChatMessagePosition = { id: string; top: number; height: number };

/** Fractional tick coordinates let the reading band move continuously between messages. */
export function chatMessageReadingRange(positions: ChatMessagePosition[], scrollTop: number, viewportHeight: number): { start: number; end: number } {
  const coordinateAt = (offset: number) => {
    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index];
      const bottom = positions[index + 1]?.top ?? position.top + position.height;
      if (offset < bottom) return index + Math.max(0, (offset - position.top) / Math.max(1, bottom - position.top));
    }
    return positions.length;
  };
  const visibleStart = coordinateAt(scrollTop);
  const visibleEnd = coordinateAt(scrollTop + viewportHeight);
  // Keep a small contiguous band readable even when one long reply fills the viewport.
  const size = Math.min(positions.length, Math.max(3, visibleEnd - visibleStart));
  const start = Math.max(0, Math.min(positions.length - size, (visibleStart + visibleEnd - size) / 2));
  return { start, end: start + size };
}

export function activeChatMessageIndex(positions: ChatMessagePosition[], scrollTop: number, viewportHeight: number, scrollHeight: number): number {
  if (scrollTop <= 1) return 0;
  if (scrollHeight - scrollTop - viewportHeight <= 56) return Math.max(0, positions.length - 1);
  const middle = scrollTop + viewportHeight / 2;
  let nearest = 0;
  let nearestDistance = Infinity;
  positions.forEach((position, index) => {
    // A long assistant reply remains current while the reader is inside it.
    const distance = Math.max(position.top - middle, middle - position.top - position.height, 0);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}
