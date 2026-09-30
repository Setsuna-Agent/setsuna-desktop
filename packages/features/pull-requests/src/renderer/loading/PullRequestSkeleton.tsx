import { Skeleton } from '@setsuna-desktop/renderer-ui';
import './skeletons.css';

const rowCounts = { list: 5, files: 8, patch: 12, checks: 4, paragraphs: 3, discussion: 1, connection: 1 };
type SkeletonKind = keyof typeof rowCounts;

/** Region skeletons also work before the feature's host context has mounted. */
export function PullRequestSkeleton({ kind, label }: { kind: SkeletonKind; label?: string }) {
  return <div className={`pr-skeleton pr-skeleton--${kind}`} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {Array.from({ length: rowCounts[kind] }, (_, index) => <div className="pr-skeleton__row" key={index}>
      {kind === 'connection' ? <>
        <Skeleton className="pr-skeleton__avatar" /><Skeleton className="pr-skeleton__title" />
        <Skeleton /><Skeleton className="pr-skeleton__action" />
      </> : kind === 'list' ? <>
        <Skeleton className="pr-skeleton__meta" /><Skeleton className="pr-skeleton__title" /><Skeleton className="pr-skeleton__meta" />
      </> : kind === 'files' || kind === 'patch' ? <>
        <Skeleton className="pr-skeleton__marker" /><Skeleton className="pr-skeleton__line" />
      </> : kind === 'checks' ? <Skeleton className="pr-skeleton__check" /> : <>
        {kind === 'discussion' ? <div className="pr-skeleton__author"><Skeleton className="pr-skeleton__avatar" /><Skeleton className="pr-skeleton__meta" /></div> : null}
        <Skeleton /><Skeleton /><Skeleton /><Skeleton />
      </>}
    </div>)}
  </div>;
}
