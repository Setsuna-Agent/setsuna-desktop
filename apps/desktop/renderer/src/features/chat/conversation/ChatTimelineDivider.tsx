import { LoadingText } from './LoadingText.js';

type ChatTimelineDividerProps = {
  accessibilityLabel: string;
  label: string;
  loading?: boolean;
  onClick?: () => void;
};

export function ChatTimelineDivider({
  accessibilityLabel,
  label,
  loading = false,
  onClick,
}: ChatTimelineDividerProps) {
  const labelNode = onClick ? (
    <button className="chat-timeline-divider__action" type="button" onClick={onClick}>
      {label}
    </button>
  ) : loading ? (
    <LoadingText className="chat-timeline-divider__label">{label}</LoadingText>
  ) : (
    <span className="chat-timeline-divider__label">{label}</span>
  );

  return (
    <div
      className={`chat-timeline-divider${loading ? ' is-loading' : ''}`}
      aria-label={accessibilityLabel}
      aria-live={loading ? 'polite' : undefined}
      role={loading ? 'status' : undefined}
    >
      <span className="chat-timeline-divider__line" />
      {labelNode}
      <span className="chat-timeline-divider__line" />
    </div>
  );
}
