import { ToastNotice } from '@setsuna-desktop/renderer-ui';
import type {
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';
import type {
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  UsageProviderDescriptor,
} from '../../contracts/index.js';
import { UsageColumnSettings } from './UsageColumnSettings.js';
import { UsageRecordsTable } from './UsageRecordsTable.js';
import { UsageRecordsPagination } from './UsageRecordsPagination.js';
import { useUsageRecordColumns } from './useUsageRecordColumns.js';
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
  const { columns, saveColumns } = useUsageRecordColumns();
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
  }, [query.from, query.limit, query.model, query.offset, query.provider, query.threadId, query.to, records]);

  useEffect(() => () => {
    requestVersionRef.current += 1;
  }, []);

  const loadPage = async (nextPage: number) => {
    if (pageLoading || !Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages || nextPage === page) return;
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
    <section className="settings-usage-card settings-usage-records" aria-label={t('feature.usage.recentCalls')}>
      <UsageRecordsTable visibleColumns={columns} providers={providers} records={pageRecords} loading={pageLoading} />
      <UsageRecordsPagination
        actions={<UsageColumnSettings columns={columns} onSave={saveColumns} />}
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecordCount}
        loading={pageLoading}
        onPageChange={(nextPage) => void loadPage(nextPage)}
      />
      {pageError ? <ToastNotice message={pageError} /> : null}
    </section>
  );
}
