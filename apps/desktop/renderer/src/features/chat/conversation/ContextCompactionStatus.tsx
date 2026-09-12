import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { CheckCircle2, Grip } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { RuntimeHookRuns } from '../tool-runs/RuntimeToolRuns.js';

type ContextCompactionStatusProps = {
  active?: boolean;
  message?: RuntimeMessage;
};

/** 压缩始终是正文中的带图标状态行，包括首条助手消息出现前的压缩。 */
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
    <div className="chat-tool-runs">
      <div className={`chat-tool-run chat-tool-run--flat chat-tool-run--${active ? 'running' : 'success'}`}>
        <div className="chat-tool-run__summary" role={active ? 'status' : undefined}>
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
