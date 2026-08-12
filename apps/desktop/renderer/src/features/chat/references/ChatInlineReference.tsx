import type { ReactNode } from 'react';

export function ChatInlineReference({
  actionLabel,
  className,
  composerCursorOffsetAdjustment,
  icon,
  label,
  onActivate,
  title,
}: {
  actionLabel?: string;
  className?: string;
  composerCursorOffsetAdjustment?: number;
  icon: ReactNode;
  label: string;
  onActivate?: () => void;
  title: string;
}) {
  const classes = [
    'chat-inline-reference',
    onActivate ? 'chat-inline-reference--action' : '',
    className,
  ].filter(Boolean).join(' ');
  const content = (
    <>
      <span className="chat-inline-reference__icon" aria-hidden="true">{icon}</span>
      <span className="chat-inline-reference__label">{label}</span>
    </>
  );

  if (onActivate) {
    return (
      <button
        aria-label={actionLabel}
        className={classes}
        title={title}
        type="button"
        onClick={onActivate}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      className={classes}
      title={title}
      data-composer-cursor-offset-adjustment={composerCursorOffsetAdjustment}
    >
      {content}
    </span>
  );
}
