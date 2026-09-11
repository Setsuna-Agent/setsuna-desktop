import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { useI18n } from '../../../../shared/i18n/I18nProvider.js';
import type { ChatMessageNavigationItem } from './chatMessageNavigation.js';
import { useChatMessageRail } from './useChatMessageRail.js';

/** Message ticks and previews share the viewport's coordinates; no floating portal is needed. */
export function ChatMessageRail({ items, scrollRef, contentRef, onScrollToOffset, onScrollToBottom }: {
  items: ChatMessageNavigationItem[];
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onScrollToOffset: (top: number) => void;
  onScrollToBottom: () => void;
}) {
  const { t } = useI18n();
  const { layout, messageOffset } = useChatMessageRail({ items, scrollRef, contentRef });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const previewId = useId();
  if (!layout.visible) return null;
  const hoveredIndex = items.findIndex((item) => item.id === hoveredId);
  const previewIndex = items.findIndex((item) => item.id === (hoveredId ?? focusedId));
  const preview = items[previewIndex];
  const focusedIndex = items.findIndex((item) => item.id === focusedId);
  const railHeight = Math.min(items.length * 14, Math.max(14, layout.height - 24));
  const previewTop = Math.max(8, Math.min(layout.height - 88,
    (layout.height - railHeight) / 2 + (previewIndex + 0.5) * railHeight / items.length - 40));
  const roleLabel = (item: ChatMessageNavigationItem) => t(item.role === 'user' ? 'chat.navigation.user' : 'chat.navigation.assistant');

  const moveFocus = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.key === 'Escape') {
      setHoveredId(null);
      setFocusedId(null);
      return;
    }
    let next: number;
    if (event.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    buttonsRef.current.get(items[next].id)?.focus({ preventScroll: true });
  };

  return (
    <nav className="chat-message-rail" aria-label={t('chat.navigation.label')} style={{ top: layout.top, height: layout.height }}>
      <div className="chat-message-rail__ticks" style={{ height: railHeight, gridTemplateRows: `repeat(${items.length}, minmax(0, 1fr))` }} onPointerLeave={() => setHoveredId(null)}>
        {items.map((item, index) => {
          const distance = hoveredIndex < 0 ? Infinity : Math.abs(index - hoveredIndex);
          const scale = distance === 0 ? 1 : distance === 1 ? 0.68 : distance === 2 ? 0.44 : 0.25;
          const readingCoverage = Math.max(0, Math.min(1, index + 1 - layout.readingStart, layout.readingEnd - index));
          const highlight = index === previewIndex ? 1 : readingCoverage;
          return (
            <button
              key={item.id}
              ref={(node) => { if (node) buttonsRef.current.set(item.id, node); else buttonsRef.current.delete(item.id); }}
              className="chat-message-rail__tick"
              type="button"
              aria-label={t('chat.navigation.jump', { index: index + 1, role: roleLabel(item), text: item.label || roleLabel(item) })}
              aria-current={index === layout.activeIndex ? 'location' : undefined}
              aria-describedby={index === previewIndex ? previewId : undefined}
              tabIndex={index === (focusedIndex < 0 ? layout.activeIndex : focusedIndex) ? 0 : -1}
              onPointerEnter={() => setHoveredId(item.id)}
              onFocus={() => setFocusedId(item.id)}
              onBlur={() => setFocusedId(null)}
              onKeyDown={(event) => moveFocus(event, index)}
              onClick={() => {
                if (index === items.length - 1) onScrollToBottom();
                else {
                  const top = messageOffset(item.id);
                  if (top !== null) onScrollToOffset(top);
                }
              }}
            >
              <span style={{ '--chat-rail-highlight': `${highlight * 100}%`, transform: `scaleX(${scale})`, opacity: 0.45 + highlight * 0.55 } as CSSProperties} />
            </button>
          );
        })}
      </div>
      {preview ? (
        <div id={previewId} role="tooltip" className="chat-message-rail__preview" style={{ top: previewTop, width: Math.min(256, layout.width - 48) }}>
          <strong>{preview.label || roleLabel(preview)}</strong>
          <p>{preview.description || roleLabel(preview)}</p>
        </div>
      ) : null}
    </nav>
  );
}
