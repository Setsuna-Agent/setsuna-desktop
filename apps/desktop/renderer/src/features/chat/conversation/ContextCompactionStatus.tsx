import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { CheckCircle2, Grip } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { RuntimeHookRuns } from '../tool-runs/RuntimeToolRuns.js';
import { ChatTimelineDivider } from './ChatTimelineDivider.js';

type ContextCompactionStatusProps = {
  active?: boolean;
  message?: RuntimeMessage;
  presentation?: 'divider' | 'tool';
};

export function ContextCompactionStatus({ active = false, message, presentation = 'divider' }: ContextCompactionStatusProps) {
  const { t } = useI18n();
  const notice = message?.contextCompaction;
  if (!active && !notice) return null;

  const compactedMessageCount = notice?.compactedMessageCount ?? 0;
  const label = active
    ? t('chat.context.compacting')
    : compactedMessageCount > 0
      ? t('chat.context.compactedCount', { count: compactedMessageCount })
      : t('chat.context.compacted');

  if (presentation === 'tool') {
    return (
      <div className="chat-tool-runs">
        <div className={`chat-tool-run chat-tool-run--flat chat-tool-run--${active ? 'running' : 'success'}`}>
          <div className="chat-tool-run__summary">
            <span className="chat-tool-run__icon">
              {active ? <Grip aria-hidden="true" size={14} /> : <CheckCircle2 aria-hidden="true" size={14} />}
            </span>
            <span className="chat-tool-run__summary-text">
              <span className="chat-tool-run__title">{label}</span>
            </span>
          </div>
          {message ? <RuntimeHookRuns runs={message.hookRuns} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-context-compaction-status">
      <ChatTimelineDivider accessibilityLabel={t('chat.context.compaction')} label={label} loading={active} />
      {message ? <RuntimeHookRuns runs={message.hookRuns} /> : null}
    </div>
  );
}
