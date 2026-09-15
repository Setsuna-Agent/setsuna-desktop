import { IconButton } from '@setsuna-desktop/renderer-ui';
import type {
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type {
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  UsageProviderDescriptor,
} from '../../contracts/index.js';
import { UsageRecordsTable } from './UsageRecordsTable.js';
import { useUsageView } from './view-context.js';

type UsageRecentCallsProps = {
  providers: readonly UsageProviderDescriptor[];
  query: RuntimeUsageQuery;
  records: readonly RuntimeUsageRecord[];
  totalRecordCount: number;
  onQueryUsage: (query: RuntimeUsageQuery) => Promise<RuntimeUsageResponse>;
};

const PAGE_SIZE = 10;

export function UsageRecentCalls({
  providers,
  query,
  records,
  totalRecordCount,
  onQueryUsage,
}: UsageRecentCallsProps) {
  const { translate: t } = useUsageView();
  const [page, setPage] = useState(1);
  const [pageRecords, setPageRecords] = useState(() => records.slice(0, PAGE_SIZE));
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const totalPages = Math.max(1, Math.ceil(totalRecordCount / PAGE_SIZE));

  useEffect(() => {
    requestVersionRef.current += 1;
    setPage(1);
    setPageRecords(records.slice(0, PAGE_SIZE));
    setPageLoading(false);
    setPageError(null);
  }, [query.from, query.limit, query.offset, query.threadId, query.to, records]);

  useEffect(() => () => {
    requestVersionRef.current += 1;
  }, []);

  const loadPage = async (nextPage: number) => {
    if (pageLoading || nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setPageLoading(true);
    setPageError(null);
    try {
      const response = await onQueryUsage({
        ...query,
        limit: PAGE_SIZE,
        offset: (nextPage - 1) * PAGE_SIZE,
      });
      if (requestVersionRef.current !== requestVersion) return;
      setPage(nextPage);
      setPageRecords([...response.records]);
    } catch {
      if (requestVersionRef.current === requestVersion) {
        setPageError(t('feature.usage.pageLoadFailed'));
      }
    } finally {
      if (requestVersionRef.current === requestVersion) setPageLoading(false);
    }
  };

  return (
    <section className="settings-usage-card settings-usage-records" aria-labelledby="settings-usage-records-title">
      <header className="settings-usage-card__header settings-usage-card__header--plain">
        <div>
          <strong id="settings-usage-records-title">{t('feature.usage.recentCalls')}</strong>
          <span>{t('feature.usage.recentCallsSubtitle')}</span>
        </div>
        <span className="settings-usage-card__count">{totalRecordCount ? t('feature.usage.totalCalls', { count: totalRecordCount }) : t('feature.usage.noRecords')}</span>
      </header>
      <UsageRecordsTable providers={providers} records={pageRecords} loading={pageLoading} />
      {totalPages > 1 ? (
        <footer className="settings-usage-records__pagination" aria-label={t('feature.usage.pagination')}>
          {pageError ? (
            <span className="settings-usage-records__pagination-error" role="alert">{pageError}</span>
          ) : null}
          <IconButton
            label={t('feature.usage.previousPage')}
            size="small"
            variant="secondary"
            disabled={page === 1 || pageLoading}
            type="button"
            onClick={() => void loadPage(page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <span aria-live="polite">{t('feature.usage.pageStatus', { page, total: totalPages })}</span>
          <IconButton
            label={t('feature.usage.nextPage')}
            size="small"
            variant="secondary"
            disabled={page === totalPages || pageLoading}
            type="button"
            onClick={() => void loadPage(page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </IconButton>
        </footer>
      ) : null}
    </section>
  );
}
