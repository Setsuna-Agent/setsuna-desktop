import type { RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { Table, type TableColumn } from '@setsuna-desktop/renderer-ui';
import type { UsageProviderDescriptor } from '../../contracts/index.js';
import { formatTokens, tokensExcludingCache, uncachedInputTokens } from './usage-format.js';
import { useUsageView } from './view-context.js';

type UsageRecordsTableProps = {
  providers: readonly UsageProviderDescriptor[];
  records: readonly RuntimeUsageRecord[];
  loading: boolean;
};

export function UsageRecordsTable({ providers, records, loading }: UsageRecordsTableProps) {
  const { host: { BrandIcon }, locale, translate: t, ui: { EmptyState } } = useUsageView();
  const timestampFormatter = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
  });
  const columns: TableColumn<RuntimeUsageRecord>[] = [
    {
      key: 'model',
      header: t('feature.usage.model'),
      width: '26%',
      cell: (record) => (
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
      ),
    },
    {
      key: 'provider',
      header: t('feature.usage.provider'),
      width: '18%',
      cell: (record) => (
        <span className="settings-usage-records__provider" title={record.provider}>
          <BrandIcon
            kind="provider"
            name={record.provider ?? ''}
            providerId={record.providerId}
            providers={providers}
          />
          <span>{record.provider || t('feature.usage.unknownProvider')}</span>
        </span>
      ),
    },
    {
      key: 'tokens',
      header: t('feature.usage.totalTokens'),
      width: '32%',
      cell: (record) => (
        <>
          <strong className="settings-usage-records__tokens" title={t('feature.usage.rawTotal', { tokens: formatTokens(record.totalTokens ?? 0) })}>
            {formatTokens(tokensExcludingCache(record))}
          </strong>
          <small>{t('feature.usage.tokenDetails', {
            input: formatTokens(uncachedInputTokens(record)),
            cache: formatTokens(record.cachedInputTokens ?? 0),
            output: formatTokens(record.outputTokens ?? 0),
          })}</small>
        </>
      ),
    },
    {
      key: 'requestCount',
      header: t('feature.usage.callCount'),
      width: '8%',
      align: 'right',
      cell: (record) => record.requestCount?.toLocaleString(locale) ?? '—',
    },
    {
      key: 'createdAt',
      header: t('feature.usage.callTime'),
      width: '16%',
      align: 'right',
      cell: (record) => (
        <time dateTime={record.createdAt}>{formatUsageTimestamp(record.createdAt, timestampFormatter)}</time>
      ),
    },
  ];

  return (
    <Table
      aria-labelledby="settings-usage-records-title"
      className="settings-usage-records__table"
      columns={columns}
      data={records}
      emptyState={<EmptyState title={t('feature.usage.empty')} />}
      getRowId={(record) => record.id}
      loading={loading}
    />
  );
}

function formatUsageTimestamp(value: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
