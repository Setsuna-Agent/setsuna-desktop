import { Skeleton } from '@setsuna-desktop/renderer-ui';
import './usage-skeleton.css';

type UsageSkeletonKind = 'overview' | 'breakdown' | 'calendar' | 'records';

export function UsageFilterSkeleton() {
  return <div className="feature-usage-skeleton-filters" aria-hidden="true">
    <Skeleton /><Skeleton /><Skeleton />
  </div>;
}

/** Lightweight placeholders are also available while the settings chunk is loading. */
export function UsageSkeleton({ kind }: { kind: UsageSkeletonKind }) {
  return <div className={`feature-usage-skeleton feature-usage-skeleton--${kind}`} aria-hidden="true">
    {kind === 'overview' ? <>
      <div className="feature-usage-skeleton__summary">
        <Skeleton className="feature-usage-skeleton__title" />
        <Skeleton className="feature-usage-skeleton__value" />
        <Skeleton className="feature-usage-skeleton__caption" />
        <div className="feature-usage-skeleton__metrics"><Skeleton /><Skeleton /><Skeleton /></div>
        <Skeleton className="feature-usage-skeleton__bar" />
        <div className="feature-usage-skeleton__lines"><Skeleton /><Skeleton /><Skeleton /></div>
      </div>
      <div className="feature-usage-skeleton__trend">
        <Skeleton className="feature-usage-skeleton__title" />
        <Skeleton className="feature-usage-skeleton__plot" />
        <Skeleton className="feature-usage-skeleton__caption" />
      </div>
    </> : <>
      {kind !== 'records' ? <Skeleton className="feature-usage-skeleton__title" /> : null}
      {kind === 'calendar' ? <>
        <div className="feature-usage-skeleton__metrics"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div>
        <Skeleton className="feature-usage-skeleton__calendar" />
      </> : kind === 'breakdown' ? <>
        <Skeleton className="feature-usage-skeleton__bar" />
        {Array.from({ length: 4 }, (_, index) => <div className="feature-usage-skeleton__row" key={index}>
          <Skeleton className="feature-usage-skeleton__icon" /><Skeleton /><Skeleton />
        </div>)}
      </> : <>
        <div className="feature-usage-skeleton__table">
          <div className="feature-usage-skeleton__record feature-usage-skeleton__record--heading">
            {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} />)}
          </div>
          {Array.from({ length: 10 }, (_, index) => <div className="feature-usage-skeleton__record" key={index}>
            <div className="feature-usage-skeleton__record-model">
              <Skeleton className="feature-usage-skeleton__icon" />
              <div><Skeleton /><Skeleton className="feature-usage-skeleton__caption" /></div>
            </div>
            <Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton /><Skeleton />
          </div>)}
        </div>
        <div className="feature-usage-skeleton__pagination">
          <Skeleton />
          <div>{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} />)}</div>
        </div>
      </>}
    </>}
  </div>;
}
