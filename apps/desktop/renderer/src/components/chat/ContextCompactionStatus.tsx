import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { ChatTimelineDivider } from './ChatTimelineDivider.js';
import { RuntimeHookRuns } from './RuntimeToolRuns.js';

type ContextCompactionStatusProps = {
  active?: boolean;
  message?: RuntimeMessage;
};

export function ContextCompactionStatus({ active = false, message }: ContextCompactionStatusProps) {
  const notice = message?.contextCompaction;
  if (!active && !notice) return null;

  const compactedMessageCount = notice?.compactedMessageCount ?? 0;
  const label = active
    ? '正在压缩上下文'
    : compactedMessageCount > 0
      ? `已压缩 ${compactedMessageCount} 条上下文`
      : '已压缩上下文';

  return (
    <div className="chat-context-compaction-status">
      <ChatTimelineDivider accessibilityLabel="上下文压缩" label={label} loading={active} />
      {message ? <RuntimeHookRuns runs={message.hookRuns} /> : null}
    </div>
  );
}
