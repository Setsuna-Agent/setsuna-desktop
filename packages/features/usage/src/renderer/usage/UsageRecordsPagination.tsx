import { Button, IconButton, TextField } from '@setsuna-desktop/renderer-ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useUsageView } from './view-context.js';

type UsageRecordsPaginationProps = {
  actions?: ReactNode;
  page: number;
  totalPages: number;
  totalRecords: number;
  loading: boolean;
  onPageChange: (page: number) => void;
};

export function UsageRecordsPagination({ actions, page, totalPages, totalRecords, loading, onPageChange }: UsageRecordsPaginationProps) {
  const { locale, translate: t } = useUsageView();
  const [draftPage, setDraftPage] = useState('');
  const targetPage = Number(draftPage);
  const canJump = !loading && /^\d+$/.test(draftPage) && Number.isSafeInteger(targetPage)
    && targetPage >= 1 && targetPage <= totalPages && targetPage !== page;

  // Keep the requested page available for retry after failure; clear it after navigation succeeds.
  useEffect(() => setDraftPage(''), [page, totalPages]);

  return (
    <footer className="settings-usage-records__pagination">
      <div className="settings-usage-records__controls">
        {actions}
        {totalRecords > 0 ? <span className="settings-usage-records__count">
          {t('feature.usage.totalCalls', { count: totalRecords.toLocaleString(locale) })}
        </span> : null}
      </div>
      {totalPages > 1 ? (
        <div className="settings-usage-records__navigation">
          <nav className="settings-usage-records__pages" aria-label={t('feature.usage.pagination')}>
            <IconButton label={t('feature.usage.previousPage')} size="small"
              disabled={page === 1 || loading} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft aria-hidden="true" />
            </IconButton>
            {paginationItems(page, totalPages).map((item) => typeof item === 'number' ? (
              <Button key={item} size="small" variant={item === page ? 'secondary' : 'ghost'}
                className="settings-usage-records__page"
                aria-current={item === page ? 'page' : undefined}
                aria-label={t('feature.usage.pageNumber', { page: item })}
                disabled={loading} onClick={() => onPageChange(item)}>
                {item.toLocaleString(locale)}
              </Button>
            ) : <span className="settings-usage-records__ellipsis" key={item} aria-hidden="true">…</span>)}
            <IconButton label={t('feature.usage.nextPage')} size="small"
              disabled={page === totalPages || loading} onClick={() => onPageChange(page + 1)}>
              <ChevronRight aria-hidden="true" />
            </IconButton>
            <span className="sd-visually-hidden" aria-live="polite">
              {t('feature.usage.pageStatus', { page, total: totalPages })}
            </span>
          </nav>
          <form className="settings-usage-records__jump" onSubmit={(event) => {
            event.preventDefault();
            if (canJump) onPageChange(targetPage);
          }}>
            <TextField aria-label={t('feature.usage.jumpToPage')} inputMode="numeric" autoComplete="off"
              value={draftPage} disabled={loading} onChange={(event) => setDraftPage(event.currentTarget.value)} />
            <Button size="small" variant="ghost" type="submit" disabled={!canJump}>{t('feature.usage.jump')}</Button>
          </form>
        </div>
      ) : null}
    </footer>
  );
}

/** Bound the number of controls even when the log contains thousands of pages. */
function paginationItems(page: number, total: number): (number | 'start-gap' | 'end-gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'end-gap', total];
  if (page >= total - 3) return [1, 'start-gap', ...Array.from({ length: 5 }, (_, index) => total - 4 + index)];
  return [1, 'start-gap', page - 1, page, page + 1, 'end-gap', total];
}
