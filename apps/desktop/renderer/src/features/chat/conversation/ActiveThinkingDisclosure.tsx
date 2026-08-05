import { ChevronDown } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { useStreamingScrollPin } from './useStreamingScrollPin.js';

export function ActiveThinkingDisclosure({
  content,
  scrollStateKey,
}: {
  content: string;
  scrollStateKey: string;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setExpanded(event.currentTarget.open);
  };

  return (
    <details className="chat-thinking-disclosure" onToggle={handleToggle}>
      <summary className="chat-thinking-disclosure__summary">
        <span className="chat-thinking-disclosure__label">{t('chat.thinking.active')}</span>
        <ChevronDown aria-hidden="true" className="chat-thinking-disclosure__chevron" size={12} />
      </summary>
      {expanded ? <ActiveThinkingContent content={content} label={t('chat.thinking.active')} scrollStateKey={scrollStateKey} /> : null}
    </details>
  );
}

function ActiveThinkingContent({
  content,
  label,
  scrollStateKey,
}: {
  content: string;
  label: string;
  scrollStateKey: string;
}) {
  const { handlePointerDown, handleScroll, handleTouchMove, handleWheel, scrollRef } = useStreamingScrollPin(content, scrollStateKey);

  return (
    <div className="chat-thinking-disclosure__panel" role="region" aria-label={label}>
      <div
        className="chat-thinking-disclosure__content"
        ref={scrollRef}
        aria-live="polite"
        onPointerDownCapture={handlePointerDown}
        onScroll={handleScroll}
        onTouchMoveCapture={handleTouchMove}
        onWheelCapture={handleWheel}
      >
        <MarkdownRenderer content={content} streaming />
      </div>
    </div>
  );
}
