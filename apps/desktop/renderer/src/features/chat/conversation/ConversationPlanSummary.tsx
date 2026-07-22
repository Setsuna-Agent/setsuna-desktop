import { CheckCircle2, Circle, ListChecks, LoaderCircle } from 'lucide-react';
import { useId } from 'react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import type { ConversationPlanItem, ConversationPlanStatus } from './chatConversationOverview.js';

export function ConversationPlanSummary({ items }: { items: ConversationPlanItem[] }) {
  const { t } = useI18n();
  const popoverId = useId();
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const inProgress = items.some((item) => item.status === 'in_progress');
  const progressLabel = `${completedCount}/${items.length}`;

  return (
    <div className="chat-conversation-overview-panel__plan">
      <button
        type="button"
        className="chat-conversation-overview-panel__row chat-conversation-overview-panel__plan-trigger"
        aria-label={t('conversation.overview.plan.aria', {
          state: t(inProgress ? 'conversation.overview.plan.running' : 'conversation.overview.plan.progress'),
          progress: progressLabel,
        })}
        aria-describedby={popoverId}
      >
        <span className="chat-conversation-overview-panel__icon">
          {inProgress
            ? <LoaderCircle className="chat-conversation-overview-panel__plan-loading" size={14} />
            : <ListChecks size={14} />}
        </span>
        <span className="chat-conversation-overview-panel__label">{t('conversation.overview.plan.title')}</span>
        <span className="chat-conversation-overview-panel__meta chat-conversation-overview-panel__plan-progress">{progressLabel}</span>
      </button>
      <div className="chat-conversation-overview-panel__plan-popover" id={popoverId} role="tooltip">
        <div className="chat-conversation-overview-panel__plan-popover-head">
          <ListChecks size={14} />
          <span>{t('conversation.overview.plan.details')}</span>
          <span>{progressLabel}</span>
        </div>
        <ol className="chat-conversation-overview-panel__plan-list">
          {items.map((item, index) => (
            <PlanRow item={item} key={`${item.step}:${index}`} t={t} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function PlanRow({ item, t }: { item: ConversationPlanItem; t: Translate }) {
  return (
    <li className={`chat-conversation-overview-panel__plan-item is-${item.status}`}>
      <span className="chat-conversation-overview-panel__plan-dot" aria-hidden="true">
        {planStatusIcon(item.status)}
      </span>
      <span className="chat-conversation-overview-panel__plan-step" title={item.step}>
        {item.step}
      </span>
      <span className="chat-conversation-overview-panel__plan-status">{planStatusLabel(item.status, t)}</span>
    </li>
  );
}

function planStatusIcon(status: ConversationPlanStatus) {
  if (status === 'completed') return <CheckCircle2 size={11} />;
  if (status === 'in_progress') return <Circle size={9} fill="currentColor" />;
  return <Circle size={9} />;
}

function planStatusLabel(status: ConversationPlanStatus, t: Translate): string {
  if (status === 'completed') return t('conversation.overview.plan.completed');
  if (status === 'in_progress') return t('conversation.overview.plan.inProgress');
  return t('conversation.overview.plan.pending');
}
