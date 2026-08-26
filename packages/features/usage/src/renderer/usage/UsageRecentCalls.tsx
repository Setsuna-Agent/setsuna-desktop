import type {
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';
import type {
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  UsageProviderDescriptor,
} from '../../contracts/index.js';
import { formatTokens } from './usage-format.js';
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
  const { host: { BrandIcon }, locale, translate: t, ui: { EmptyState } } = useUsageView();
  const [page, setPage] = useState(1);
  const [pageRecords, setPageRecords] = useState(() => records.slice(0, PAGE_SIZE));
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const usageTimestampFormatter = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
  });
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
      {pageRecords.length ? (
        <div className="settings-usage-records__scroller">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('feature.usage.model')}</th>
                <th scope="col">{t('feature.usage.provider')}</th>
                <th scope="col">Token</th>
                <th scope="col">{t('feature.usage.callTime')}</th>
              </tr>
            </thead>
            <tbody>
              {pageRecords.map((record) => (
                <tr key={record.id}>
                  <td>
                    <div className="settings-usage-records__model">
                      <span className="settings-usage-records__model-icon">
                        <BrandIcon
                          kind="model"
                          name={record.model ?? ''}
                          providerId={record.providerId}
                          providerName={record.provider}
                          providers={providers}
                        />
                      </span>
                      <strong title={record.model}>{record.model || t('feature.usage.unknownModel')}</strong>
                    </div>
                  </td>
                  <td>
                    <span className="settings-usage-records__provider" title={record.provider}>
                      <BrandIcon
                        kind="provider"
                        name={record.provider ?? ''}
                        providerId={record.providerId}
                        providers={providers}
                      />
                      <span>{record.provider || t('feature.usage.unknownProvider')}</span>
                    </span>
                  </td>
                  <td>
                    <strong className="settings-usage-records__tokens">{formatTokens(record.totalTokens ?? 0)}</strong>
                    <small>{t('feature.usage.tokenDetails', {
                      input: formatTokens(record.inputTokens ?? 0),
                      cache: formatTokens(record.cachedInputTokens ?? 0),
                      output: formatTokens(record.outputTokens ?? 0),
                    })}</small>
                  </td>
                  <td><time dateTime={record.createdAt}>{formatUsageTimestamp(record.createdAt, usageTimestampFormatter)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={t('feature.usage.empty')} />
      )}
      {totalPages > 1 ? (
        <footer className="settings-usage-records__pagination" aria-label={t('feature.usage.pagination')}>
          {pageError ? (
            <span className="settings-usage-records__pagination-error" role="alert">{pageError}</span>
          ) : null}
          <button
            aria-label={t('feature.usage.previousPage')}
            disabled={page === 1 || pageLoading}
            type="button"
            onClick={() => void loadPage(page - 1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span aria-live="polite">{t('feature.usage.pageStatus', { page, total: totalPages })}</span>
          <button
            aria-label={t('feature.usage.nextPage')}
            disabled={page === totalPages || pageLoading}
            type="button"
            onClick={() => void loadPage(page + 1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        </footer>
      ) : null}
    </section>
  );
}

function formatUsageTimestamp(value: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
