import { Check, Circle, CircleX, Clock3, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Loader2 } from 'lucide-react';
import type { PullRequestDetail, PullRequestSummary } from '../contracts/index.js';
import { usePrText, usePullRequestsHost } from './context.js';

export function PullRequestState({ pr, label = true }: { pr: PullRequestSummary; label?: boolean }) {
  const t = usePrText();
  const state = pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.draft ? 'draft' : 'open';
  const Icon = state === 'merged' ? GitMerge : state === 'closed' ? GitPullRequestClosed : state === 'draft' ? GitPullRequestDraft : GitPullRequest;
  return <span className={`pr-state pr-state--${state}`} title={t(state)}><Icon size={15} />{label ? t(state) : null}</span>;
}
export function CheckState({ state, label = true }: { state: string | null; label?: boolean }) {
  const t = usePrText();
  const tone = checkTone(state);
  const Icon = tone === 'success' ? Check : tone === 'danger' ? CircleX : tone === 'pending' ? Clock3 : Circle;
  return <span className={`pr-check-state pr-check-state--${tone}`} title={state ? stateLabel(state, t) : t('unknown')}><Icon size={14} />{label ? state ? stateLabel(state, t) : t('unknown') : null}</span>;
}
export function checkTone(state: string | null): 'success' | 'danger' | 'pending' | 'muted' {
  if (state && ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) return 'success';
  if (state && ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(state)) return 'danger';
  if (state && ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED'].includes(state)) return 'pending';
  return 'muted';
}
export function stateLabel(state: string, t: ReturnType<typeof usePrText>): string {
  const names: Record<string, string> = {
    SUCCESS: 'passed', NEUTRAL: 'neutral', SKIPPED: 'skipped', FAILURE: 'failed', ERROR: 'failed', TIMED_OUT: 'timedOut',
    ACTION_REQUIRED: 'actionRequired', STARTUP_FAILURE: 'failed', PENDING: 'pending', QUEUED: 'queued', IN_PROGRESS: 'running',
    WAITING: 'waiting', REQUESTED: 'requested', EXPECTED: 'waiting', CANCELLED: 'cancelled', STALE: 'outdated',
    APPROVED: 'approved', CHANGES_REQUESTED: 'changesRequested', REVIEW_REQUIRED: 'reviewRequired', COMMENTED: 'commented', DISMISSED: 'dismissed',
  };
  return names[state] ? t(names[state]) : state;
}
export function mergeCondition(pr: PullRequestDetail, t: ReturnType<typeof usePrText>): {
  label: string; tone: 'merged' | 'success' | 'danger' | 'pending' | 'muted';
} {
  // Resolve the label and tone together so multiple blockers keep the same priority.
  if (pr.state === 'MERGED') return { label: t('merged'), tone: 'merged' };
  if (pr.state === 'CLOSED') return { label: t('closed'), tone: 'danger' };
  if (pr.queueState) return { label: t('inQueue', { state: stateLabel(pr.queueState, t) }), tone: 'pending' };
  if (pr.draft) return { label: t('draftBlocked'), tone: 'muted' };
  if (pr.mergeable === 'CONFLICTING') return { label: t('conflicts'), tone: 'danger' };
  if (pr.mergeable === 'UNKNOWN' || pr.mergeState === 'UNKNOWN') return { label: t('calculating'), tone: 'pending' };
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return { label: t('changesRequested'), tone: 'danger' };
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return { label: t('reviewRequired'), tone: 'pending' };
  if (pr.mergeState === 'BEHIND' && !pr.queueRequired) return { label: t('behind'), tone: 'pending' };
  if (pr.mergeState === 'BLOCKED') return { label: t('blocked'), tone: 'pending' };
  if (!pr.canMerge) return { label: t('noMergePermission'), tone: 'muted' };
  if (pr.queueRequired) return { label: t('queueRequired'), tone: 'pending' };
  return { label: t('readyToMerge'), tone: 'success' };
}
export function Timestamp({ value }: { value: string }) {
  const { locale } = usePullRequestsHost();
  const date = new Date(value);
  return <time dateTime={value} title={date.toLocaleString(locale)}>{date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} {date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>;
}
export function Loading() { const t = usePrText(); return <span className="pr-loading" role="status"><Loader2 size={15} className="pr-spin" />{t('loading')}</span>; }
