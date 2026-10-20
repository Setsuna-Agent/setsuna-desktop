import { Button, IconButton, Popover } from '@setsuna-desktop/renderer-ui';
import { ArrowRight, ChevronDown, FileDiff, GitMerge, Info, Settings2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { PullRequestDetail } from '../contracts/index.js';
import { usePrText } from './context.js';
import { GitHubAvatar } from './GitHubIdentity.js';
import { CheckState, mergeCondition, reviewTone, stateLabel, toneIcons } from './status.js';

export function PullRequestBranches({ detail }: { detail: Pick<PullRequestDetail, 'headBranch' | 'baseBranch'> }) {
  const t = usePrText();
  return <span className="pr-branches" aria-label={t('branch')}>
    <code title={detail.headBranch}>{detail.headBranch}</code>
    <ArrowRight size={12} aria-hidden="true" />
    <code title={detail.baseBranch}>{detail.baseBranch}</code>
  </span>;
}

type MetaProps = { detail: PullRequestDetail; onChecks(): void; onDiff(): void };

/** Keep secondary metadata available without reserving space beside the reading column. */
export function PullRequestMetaMenu({ detail, onChecks, onDiff }: MetaProps) {
  const t = usePrText();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const select = (action: () => void) => { pendingAction.current = action; setOpen(false); };
  return <Popover open={open} onOpenChange={setOpen} placement="bottomRight" className="pr-meta-popover" contentLabel={t('statusPanel')}
    onCloseAutoFocus={(event) => {
      const action = pendingAction.current;
      pendingAction.current = null;
      if (!action) return;
      // Finish closing the popover before a dialog captures its return-focus target.
      event.preventDefault();
      triggerRef.current?.focus({ preventScroll: true });
      action();
    }}
    content={<PullRequestMetaPanel detail={detail}
      onChecks={() => select(onChecks)} onDiff={() => select(onDiff)} />}>
    <IconButton ref={triggerRef} size="small" label={t('statusPanel')}><Info size={14} /></IconButton>
  </Popover>;
}

function PullRequestMetaPanel({ detail, onChecks, onDiff }: MetaProps) {
  const t = usePrText();
  const progress = detail.checksProgress;
  const merge = mergeCondition(detail, t);
  return <aside className="pr-meta" aria-label={t('statusPanel')}>
    <MetaRow onClick={onDiff} icon={<FileDiff size={14} />} label={t('changedFiles', { count: detail.fileCount })}
      value={<span className="pr-diff-counts"><span>+{detail.additions}</span><span>−{detail.deletions}</span></span>} />
    <MetaRow onClick={onChecks} icon={<CheckState state={detail.checksState} label={false} />} label={t('checks')}
      value={<span className="pr-meta__check-result">
        <span>{detail.checksState ? stateLabel(detail.checksState, t) : t('unknown')}</span>
        {progress ? <span>{progress.passed}/{progress.total}</span> : null}
      </span>} />
    <MetaRow icon={<GitMerge size={14} />} label={t('merge')} value={merge.label} valueTitle={merge.label} />
    {detail.state === 'OPEN' ? <MetaRow icon={<Settings2 size={14} />} label={t('autoMerge')}
      value={t(detail.autoMerge ? 'enabled' : 'notEnabled')}
      valueTitle={detail.autoMerge ? `${detail.autoMerge.author.login} · ${detail.autoMerge.method}` : undefined} /> : null}
    {detail.reviewers.length ? <details className="pr-meta__reviewers">
      <summary><span>{t('reviewers')}</span><span className="pr-meta__reviewer-count">{detail.reviewers.length}<ChevronDown size={14} aria-hidden="true" /></span></summary>
      {detail.reviewers.map((reviewer) => {
        const tone = reviewTone(reviewer.state);
        const Icon = toneIcons[tone];
        return <MetaRow key={reviewer.name}
          icon={<GitHubAvatar login={reviewer.name} avatarUrl={reviewer.avatarUrl} />}
          label={<span title={reviewer.name}>{reviewer.name}</span>}
          value={<span className={`pr-review-state pr-check-state--${tone}`}><Icon size={12} aria-hidden="true" />{stateLabel(reviewer.state, t)}</span>} />;
      })}
    </details> : null}
  </aside>;
}

/**
 * Icons and avatars share a fixed first column so every label starts on the same edge;
 * label and value are baseline-aligned while the icon is centered on the row.
 */
function MetaRow({ icon, label, value, valueTitle, onClick }: { icon: ReactNode; label: ReactNode; value?: ReactNode; valueTitle?: string; onClick?(): void }) {
  const cells = <>
    <span className="pr-meta__icon" aria-hidden="true">{icon}</span>
    <span className="pr-meta__label">{label}</span>
    {value ? <span className="pr-meta__value" title={valueTitle}>{value}</span> : null}
  </>;
  return onClick
    ? <Button variant="ghost" className="pr-meta__row pr-meta__row--action" onClick={onClick}>{cells}</Button>
    : <div className="pr-meta__row">{cells}</div>;
}
