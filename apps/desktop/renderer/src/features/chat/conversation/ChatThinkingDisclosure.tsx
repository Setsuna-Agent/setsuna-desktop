import { Atom as ThinkIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { memo, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { LoadingText } from './LoadingText.js';
import { useStreamingScrollPin } from './useStreamingScrollPin.js';

export const ChatThinkingDisclosure = memo(function ChatThinkingDisclosure({
  active,
  content,
  scrollStateKey,
}: {
  active: boolean;
  content: string;
  scrollStateKey: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const label = t(active ? 'chat.thinking.active' : 'chat.thinking.completed');
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setExpanded(event.currentTarget.open);
  };

  return (
    <details className={`chat-thinking-disclosure ${active ? 'is-active' : ''}`} onToggle={handleToggle}>
      <summary className="chat-thinking-disclosure__summary">
        <span className="chat-thinking-disclosure__status">
          <span className="chat-thinking-disclosure__icon" aria-hidden="true">
            <ThinkIcon />
          </span>
          {active ? (
            <LoadingText className="chat-thinking-disclosure__label">{label}</LoadingText>
          ) : (
            <span className="chat-thinking-disclosure__label">{label}</span>
          )}
        </span>
        <ChevronDown aria-hidden="true" className="chat-thinking-disclosure__chevron" size={12} />
      </summary>
      {expanded ? (
        <ThinkingContent active={active} content={content} label={label} scrollStateKey={scrollStateKey} />
      ) : null}
    </details>
  );
});

function ThinkingContent({
  active,
  content,
  label,
  scrollStateKey,
}: {
  active: boolean;
  content: string;
  label: string;
  scrollStateKey: string;
}) {
  const { contentRef, handleKeyDown, handlePointerDown, handleScroll, handleTouchMove, handleWheel, scrollRef } = useStreamingScrollPin(content, scrollStateKey, active);

  return (
    <ThinkingPanel label={label}>
      <div
        className="chat-thinking-disclosure__content"
        ref={scrollRef}
        aria-live={active ? 'polite' : undefined}
        onKeyDownCapture={handleKeyDown}
        onPointerDownCapture={handlePointerDown}
        onScroll={handleScroll}
        onTouchMoveCapture={handleTouchMove}
        onWheelCapture={handleWheel}
      >
        <div ref={contentRef}>
          <MarkdownRenderer content={content} legacyThinkingTags={false} streaming={active} />
        </div>
      </div>
    </ThinkingPanel>
  );
}

function ThinkingPanel({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="chat-thinking-disclosure__panel" role="region" aria-label={label}>
      {children}
    </div>
  );
}
