import { CheckCircle2, ChevronsRightLeft, Circle, FileText, FolderOpen, ListChecks } from 'lucide-react';
import type { ConversationOverviewState, ConversationPlanItem, ConversationPlanStatus } from './chatConversationOverview.js';

export function ConversationOverviewPanel({
  compact,
  contextLabel,
  contextPercent,
  overview,
  onCollapse,
  onExpand,
  onOpenFiles,
  onOpenReview,
}: {
  compact: boolean;
  contextLabel: string;
  contextPercent: number;
  overview: ConversationOverviewState;
  onCollapse: () => void;
  onExpand: () => void;
  onOpenFiles: () => void;
  onOpenReview?: () => void;
}) {
  const summary = overview.fileChangeSummary;
  const additions = summary?.additions ?? 0;
  const deletions = summary?.deletions ?? 0;
  const hasFileChanges = Boolean(summary?.files.length);

  if (compact) {
    return (
      <button className="chat-conversation-overview-chip" type="button" aria-label="展开对话环境信息" onClick={onExpand}>
        <FileText size={13} />
        <span>{hasFileChanges ? '变更' : '环境'}</span>
        {hasFileChanges ? (
          <ChangeCountText additions={additions} deletions={deletions} />
        ) : (
          <span className="chat-conversation-overview-chip__meta">{contextLabel}</span>
        )}
      </button>
    );
  }

  return (
    <section className="chat-conversation-overview-panel" aria-label="环境信息">
      <div className="chat-conversation-overview-panel__header">
        <span>环境信息</span>
        <button type="button" aria-label="折叠环境信息" title="折叠环境信息" onClick={onCollapse}>
          <ChevronsRightLeft size={13} />
        </button>
      </div>
      <div className="chat-conversation-overview-panel__actions">
        <button type="button" className="chat-conversation-overview-panel__row" disabled={!onOpenReview} onClick={onOpenReview}>
          <span className="chat-conversation-overview-panel__icon">
            <FileText size={14} />
          </span>
          <span className="chat-conversation-overview-panel__label">变更</span>
          <span className="chat-conversation-overview-panel__meta">
            {hasFileChanges ? <ChangeCountText additions={additions} deletions={deletions} /> : '无变更'}
          </span>
        </button>
        <div className="chat-conversation-overview-panel__row chat-conversation-overview-panel__row--static">
          <span className="chat-conversation-overview-panel__icon">
            <ContextProgressIcon percent={contextPercent} />
          </span>
          <span className="chat-conversation-overview-panel__label">上下文</span>
          <span className="chat-conversation-overview-panel__meta">{contextLabel}</span>
        </div>
        <button type="button" className="chat-conversation-overview-panel__row" onClick={onOpenFiles}>
          <span className="chat-conversation-overview-panel__icon">
            <FolderOpen size={14} />
          </span>
          <span className="chat-conversation-overview-panel__label">打开文件</span>
        </button>
      </div>
      {overview.planItems.length ? (
        <>
          <div className="chat-conversation-overview-panel__divider" />
          <div className="chat-conversation-overview-panel__plan">
            <div className="chat-conversation-overview-panel__plan-title">
              <ListChecks size={14} />
              <span>计划</span>
            </div>
            <ol className="chat-conversation-overview-panel__plan-list">
              {overview.planItems.map((item, index) => (
                <PlanRow item={item} key={`${item.status}:${index}:${item.step}`} />
              ))}
            </ol>
          </div>
        </>
      ) : null}
    </section>
  );
}

function ChangeCountText({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="chat-conversation-overview-change-counts" aria-label={`新增 ${additions} 行，删除 ${deletions} 行`}>
      <span className="chat-conversation-overview-change-counts__add">+{additions}</span>
      <span className="chat-conversation-overview-change-counts__del">-{deletions}</span>
    </span>
  );
}

function ContextProgressIcon({ percent }: { percent: number }) {
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const clampedPercent = Math.min(100, Math.max(0, Number(percent) || 0));
  const dashOffset = circumference * (1 - clampedPercent / 100);
  return (
    <svg className="chat-conversation-overview-progress-icon" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={radius} />
      <circle cx="7" cy="7" r={radius} strokeDasharray={circumference} strokeDashoffset={dashOffset} />
    </svg>
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
