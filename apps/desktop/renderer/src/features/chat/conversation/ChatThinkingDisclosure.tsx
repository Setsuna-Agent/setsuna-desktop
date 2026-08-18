import ThinkIcon from '@ant-design/x/es/think/icons/think.js';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { useStreamingScrollPin } from './useStreamingScrollPin.js';

export function ChatThinkingDisclosure({
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
        <span className={`chat-thinking-disclosure__status ${active ? 'chat-loading-text' : ''}`}>
          <span className="chat-thinking-disclosure__icon" aria-hidden="true">
            <ThinkIcon />
          </span>
          <span className="chat-thinking-disclosure__label">{label}</span>
        </span>
        <ChevronDown aria-hidden="true" className="chat-thinking-disclosure__chevron" size={12} />
      </summary>
      {expanded ? (
        active
          ? <ActiveThinkingContent content={content} label={label} scrollStateKey={scrollStateKey} />
          : <ThinkingContent content={content} label={label} />
      ) : null}
    </details>
  );
}

function ThinkingContent({ content, label }: { content: string; label: string }) {
  return (
    <ThinkingPanel label={label}>
      <div className="chat-thinking-disclosure__content">
        <MarkdownRenderer content={content} legacyThinkingTags={false} streaming={false} />
      </div>
    </ThinkingPanel>
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
    <ThinkingPanel label={label}>
      <div
        className="chat-thinking-disclosure__content"
        ref={scrollRef}
        aria-live="polite"
        onPointerDownCapture={handlePointerDown}
        onScroll={handleScroll}
        onTouchMoveCapture={handleTouchMove}
        onWheelCapture={handleWheel}
      >
        <MarkdownRenderer content={content} legacyThinkingTags={false} streaming />
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
