import { CheckCircle2, Circle, ListChecks, LoaderCircle } from 'lucide-react';
import { useId } from 'react';
import type { ConversationPlanItem, ConversationPlanStatus } from './chatConversationOverview.js';

export function ConversationPlanSummary({ items }: { items: ConversationPlanItem[] }) {
  const popoverId = useId();
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const inProgress = items.some((item) => item.status === 'in_progress');
  const progressLabel = `${completedCount}/${items.length}`;

  return (
    <div className="chat-conversation-overview-panel__plan">
      <button
        type="button"
        className="chat-conversation-overview-panel__row chat-conversation-overview-panel__plan-trigger"
        aria-label={`${inProgress ? '计划推进中' : '计划进度'}，已完成 ${progressLabel}`}
        aria-describedby={popoverId}
      >
        <span className="chat-conversation-overview-panel__icon">
          {inProgress
            ? <LoaderCircle className="chat-conversation-overview-panel__plan-loading" size={14} />
            : <ListChecks size={14} />}
        </span>
        <span className="chat-conversation-overview-panel__label">计划</span>
        <span className="chat-conversation-overview-panel__meta chat-conversation-overview-panel__plan-progress">{progressLabel}</span>
      </button>
      <div className="chat-conversation-overview-panel__plan-popover" id={popoverId} role="tooltip">
        <div className="chat-conversation-overview-panel__plan-popover-head">
          <ListChecks size={14} />
          <span>计划详情</span>
          <span>{progressLabel}</span>
        </div>
        <ol className="chat-conversation-overview-panel__plan-list">
          {items.map((item, index) => (
            <PlanRow item={item} key={`${item.step}:${index}`} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function PlanRow({ item }: { item: ConversationPlanItem }) {
  return (
    <li className={`chat-conversation-overview-panel__plan-item is-${item.status}`}>
      <span className="chat-conversation-overview-panel__plan-dot" aria-hidden="true">
        {planStatusIcon(item.status)}
      </span>
      <span className="chat-conversation-overview-panel__plan-step" title={item.step}>
        {item.step}
      </span>
      <span className="chat-conversation-overview-panel__plan-status">{planStatusLabel(item.status)}</span>
    </li>
  );
}

function planStatusIcon(status: ConversationPlanStatus) {
  if (status === 'completed') return <CheckCircle2 size={11} />;
  if (status === 'in_progress') return <Circle size={9} fill="currentColor" />;
  return <Circle size={9} />;
}

function planStatusLabel(status: ConversationPlanStatus): string {
  if (status === 'completed') return '完成';
  if (status === 'in_progress') return '进行中';
  return '待办';
}
