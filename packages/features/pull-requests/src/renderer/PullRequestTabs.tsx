import { Skeleton, Tabs, TabsList, TabsTrigger } from '@setsuna-desktop/renderer-ui';
import type { PullRequestDetail } from '../contracts/index.js';
import { usePrText } from './context.js';
import type { PullRequestTab } from './session.js';

/** Loading and loaded details share geometry; counts use their actual text width. */
export function PullRequestTabs({ tab, detail, onSelect }: {
  tab: PullRequestTab;
  detail?: Pick<PullRequestDetail, 'fileCount' | 'checksProgress'>;
  onSelect?(value: PullRequestTab): void;
}) {
  const t = usePrText();
  return <Tabs className="pr-tabs" value={tab} onValueChange={(value) => {
    if (value === 'overview' || value === 'diff' || value === 'checks') onSelect?.(value);
  }}>
    <TabsList className="pr-tabs__list" aria-label={t('pullRequest')}>
      {(['overview', 'diff', 'checks'] as const).map((value) => <TabsTrigger
        id={`pr-tab-${value}`} key={value} value={value} disabled={!onSelect}
        aria-controls={onSelect ? `pr-panel-${value}` : undefined}
        className="pr-tabs__trigger" indicatorClassName="pr-tabs__indicator"
      >
        {t(value)}
        {value === 'diff' ? <small className="pr-tabs__count">{detail ? detail.fileCount : <Skeleton />}</small> : null}
        {value === 'checks' && (!detail || detail.checksProgress) ? <small className="pr-tabs__count pr-tabs__count--checks" title={detail?.checksProgress ? t('checksProgress', detail.checksProgress) : undefined}>
          {detail?.checksProgress ? `${detail.checksProgress.passed}/${detail.checksProgress.total}` : <Skeleton />}
        </small> : null}
      </TabsTrigger>)}
    </TabsList>
  </Tabs>;
}
