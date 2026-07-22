import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { RuntimeHookRuns } from '../tool-runs/RuntimeToolRuns.js';
import { ChatTimelineDivider } from './ChatTimelineDivider.js';

type ContextCompactionStatusProps = {
  active?: boolean;
  message?: RuntimeMessage;
};

export function ContextCompactionStatus({ active = false, message }: ContextCompactionStatusProps) {
  const { t } = useI18n();
  const notice = message?.contextCompaction;
  if (!active && !notice) return null;

  const compactedMessageCount = notice?.compactedMessageCount ?? 0;
  const label = active
    ? t('chat.context.compacting')
    : compactedMessageCount > 0
      ? t('chat.context.compactedCount', { count: compactedMessageCount })
      : t('chat.context.compacted');

  return (
    <div className="chat-context-compaction-status">
      <ChatTimelineDivider accessibilityLabel={t('chat.context.compaction')} label={label} loading={active} />
      {message ? <RuntimeHookRuns runs={message.hookRuns} /> : null}
    </div>
  );
}
