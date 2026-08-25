export function ConversationDebugLoadingState({ label }: { label: string }) {
  return (
    <div
      className="conversation-debug-panel__placeholder"
      role="status"
      aria-live="polite"
    >
      <span className="conversation-debug-loading" aria-hidden="true">
        <span className="conversation-debug-loading__node" />
        <span className="conversation-debug-loading__node" />
        <span className="conversation-debug-loading__node" />
      </span>
      <span className="conversation-debug-loading__label">{label}</span>
    </div>
  );
}
