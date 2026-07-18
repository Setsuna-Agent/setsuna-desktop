import { ChevronsRightLeft, CircleGauge, FileText } from 'lucide-react';
import type { RuntimeThread, RuntimeThreadSummary, RuntimeUsageResponse, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { DesktopReviewLoadOptions, DesktopReviewState } from '../workspace/model.js';
import { localReviewChangeStats } from '../workspace/reviewChanges.js';
import { ChangeCountText } from './ChangeCountText.js';
import type { ConversationOverviewState } from './chatConversationOverview.js';
import { ConversationGitControls } from './ConversationGitControls.js';
import { ConversationPlanSummary } from './ConversationPlanSummary.js';

export function ConversationOverviewPanel({
  activeProject,
  compact,
  contextLabel,
  contextPercent,
  currentThread,
  overview,
  reviewLoading,
  reviewState,
  threadUsage,
  threads,
  onCollapse,
  onExpand,
  onOpenReview,
  onOpenThread,
  onReviewRefresh,
  reviewError,
}: {
  activeProject?: WorkspaceProject;
  compact: boolean;
  contextLabel: string;
  contextPercent: number;
  currentThread: RuntimeThread;
  overview: ConversationOverviewState;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  threadUsage: RuntimeUsageResponse | null;
  threads: RuntimeThreadSummary[];
  onCollapse: () => void;
  onExpand: () => void;
  onOpenReview?: () => void;
  onOpenThread: (threadId: string) => void | Promise<void>;
  onReviewRefresh?: (options?: DesktopReviewLoadOptions) => void | Promise<void>;
  reviewError: string | null;
}) {
  const changeStats = reviewState?.isGitRepository
    ? localReviewChangeStats(reviewState)
    : {
        additions: overview.fileChangeSummary?.additions ?? 0,
        deletions: overview.fileChangeSummary?.deletions ?? 0,
        fileCount: overview.fileChangeSummary?.files.length ?? 0,
      };
  const hasFileChanges = changeStats.fileCount > 0;
  // The first status read is pending before its effect has flipped reviewLoading on.
  const reviewPending = Boolean(activeProject && !reviewState && !reviewError);
  const reviewFailed = Boolean(activeProject && !reviewState && reviewError);
  const usageSummary = threadUsage?.summary;
  const latestTurn = currentThread.turns?.at(-1);
  // 分叉是独立对话；只有派生的子代理属于协作任务。
  const childThreads = threads.filter((thread) => thread.parentThreadId === currentThread.id);
  const diagnosticLabel = turnDiagnosticLabel(latestTurn);
  const usageDiagnosticLabel = `${formatUsageTokens(usageSummary?.totalTokens ?? 0)} · ${usageSummary?.recordCount ?? 0} 次 · ${diagnosticLabel}`;

  if (compact) {
    return (
      <button className="chat-conversation-overview-chip" type="button" aria-label="展开对话环境信息" onClick={onExpand}>
        <FileText size={13} />
        <span>{hasFileChanges ? '变更' : '环境'}</span>
        {hasFileChanges ? (
          <ChangeCountText additions={changeStats.additions} deletions={changeStats.deletions} />
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
        <button
          type="button"
          className="chat-conversation-overview-panel__row"
          disabled={!onOpenReview}
          onClick={() => onOpenReview?.()}
        >
          <span className="chat-conversation-overview-panel__icon">
            <FileText size={14} />
          </span>
          <span className="chat-conversation-overview-panel__label">变更</span>
          <span className="chat-conversation-overview-panel__meta" title={reviewFailed ? reviewError ?? undefined : undefined}>
            {hasFileChanges ? (
              <ChangeCountText additions={changeStats.additions} deletions={changeStats.deletions} />
            ) : reviewPending ? '加载中' : reviewFailed ? '加载失败' : '无变更'}
          </span>
        </button>
        <ConversationGitControls
          activeProject={activeProject}
          reviewError={reviewError}
          reviewLoading={reviewLoading}
          reviewState={reviewState}
          onReviewRefresh={onReviewRefresh}
        />
        <div className="chat-conversation-overview-panel__row chat-conversation-overview-panel__row--static">
          <span className="chat-conversation-overview-panel__icon">
            <ContextProgressIcon percent={contextPercent} />
          </span>
          <span className="chat-conversation-overview-panel__label">上下文</span>
          <span className="chat-conversation-overview-panel__meta">{contextLabel}</span>
        </div>
        <div className="chat-conversation-overview-panel__row chat-conversation-overview-panel__row--static">
          <span className="chat-conversation-overview-panel__icon"><CircleGauge size={14} /></span>
          <span className="chat-conversation-overview-panel__label">用量与诊断</span>
          <span className="chat-conversation-overview-panel__meta" title={usageDiagnosticLabel}>{usageDiagnosticLabel}</span>
        </div>
      </div>
      {childThreads.length ? (
        <>
          <div className="chat-conversation-overview-panel__divider" />
          <div className="chat-conversation-overview-panel__agents">
            <div className="chat-conversation-overview-panel__agents-title">
              <span>协作任务</span>
              <span aria-label={`${childThreads.length} 个协作任务`}>{childThreads.length}</span>
            </div>
            {childThreads.map((thread) => (
              <button type="button" key={thread.id} onClick={() => void onOpenThread(thread.id)}>
                <span className={thread.activeTurnId ? 'is-running' : undefined} aria-hidden="true" />
                <strong title={thread.title}>{thread.title || '未命名任务'}</strong>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {overview.planItems.length ? (
        <>
          <div className="chat-conversation-overview-panel__divider" />
          <ConversationPlanSummary items={overview.planItems} />
        </>
      ) : null}
    </section>
  );
}

function formatUsageTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function turnDiagnosticLabel(turn: NonNullable<RuntimeThread['turns']>[number] | undefined): string {
  if (!turn) return '暂无运行记录';
  const status = turn.status === 'in_progress' ? '运行中' : turn.status === 'completed' ? '已完成' : turn.status === 'failed' ? '失败' : turn.status === 'cancelled' ? '已取消' : '状态未知';
  const signals = [
    turn.modelVerifications?.length ? `${turn.modelVerifications.length} 次验证` : null,
    turn.safetyBuffering ? '安全缓冲' : null,
  ].filter(Boolean);
  return signals.length ? `${status} · ${signals.join(' · ')}` : status;
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
