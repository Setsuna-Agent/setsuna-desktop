import type { CSSProperties, ReactNode } from 'react';
import type { RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { Table, type TableColumn } from '@setsuna-desktop/renderer-ui';
import type { UsageProviderDescriptor } from '../../contracts/index.js';
import { formatTokens, tokensExcludingCache, uncachedInputTokens } from './usage-format.js';
import { USAGE_RECORD_COLUMNS, type UsageRecordColumnKey } from './usageRecordColumns.js';
import { usageOutputSpeed } from './usageRecordMetrics.js';
import { useUsageView } from './view-context.js';
import './usage-records.css';

type UsageRecordsTableProps = {
  providers: readonly UsageProviderDescriptor[];
  records: readonly RuntimeUsageRecord[];
  visibleColumns: readonly UsageRecordColumnKey[];
  loading: boolean;
};

export function UsageRecordsTable({ providers, records, visibleColumns, loading }: UsageRecordsTableProps) {
  const { host: { BrandIcon }, locale, translate: t, ui: { EmptyState } } = useUsageView();
  const timestampFormatter = new Intl.DateTimeFormat(locale, {
    day: '2-digit', hour: '2-digit', hour12: false, minute: '2-digit', month: '2-digit',
  });
  const numberFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const providerCell = (record: RuntimeUsageRecord) => (
    <span className="settings-usage-records__provider" title={record.provider}>
      <BrandIcon kind="provider" name={record.provider ?? ''} providerId={record.providerId} providers={providers} />
      <span>{record.provider || t('feature.usage.unknownProvider')}</span>
    </span>
  );
  const cells: Record<UsageRecordColumnKey, (record: RuntimeUsageRecord) => ReactNode> = {
    model: (record) => (
      <div className="settings-usage-records__model">
        <span className="settings-usage-records__model-icon">
          <BrandIcon kind="model" name={record.model ?? ''} providerId={record.providerId} providerName={record.provider} providers={providers} />
        </span>
        <div className="settings-usage-records__identity">
          <strong title={record.model}>{record.model || t('feature.usage.unknownModel')}</strong>
          {visibleColumns.includes('provider') ? null : providerCell(record)}
        </div>
      </div>
    ),
    provider: providerCell,
    source: (record) => record.source ? t(`feature.usage.source.${record.source}`) : '—',
    result: (record) => record.result ? (
      <span className={`settings-usage-records__result settings-usage-records__result--${record.result}`}>
        <span aria-hidden="true" />{t(`feature.usage.result.${record.result}`)}
      </span>
    ) : '—',
    tokens: (record) => (
      <strong className="settings-usage-records__total" title={record.totalTokens === undefined ? undefined : t('feature.usage.rawTotal', { tokens: formatTokens(record.totalTokens) })}>
        {record.totalTokens !== undefined || (record.inputTokens !== undefined && record.outputTokens !== undefined)
          ? formatTokens(tokensExcludingCache(record)) : '—'}
      </strong>
    ),
    input: (record) => record.inputTokens === undefined ? '—' : formatTokens(uncachedInputTokens(record)),
    cache: (record) => optionalTokens(record.cachedInputTokens),
    output: (record) => optionalTokens(record.outputTokens),
    duration: (record) => record.durationMs === undefined ? '—' : (
      record.durationMs < 1000 ? `${Math.round(record.durationMs)} ms` : `${numberFormatter.format(record.durationMs / 1000)} s`
    ),
    speed: (record) => {
      const speed = usageOutputSpeed(record);
      return speed === undefined ? '—' : <span title={t('feature.usage.outputSpeedHint')}>{numberFormatter.format(speed)} tok/s</span>;
    },
    requestCount: (record) => record.requestCount?.toLocaleString(locale) ?? '—',
    createdAt: (record) => <time dateTime={record.createdAt} title={record.createdAt}>{formatUsageTimestamp(record.createdAt, timestampFormatter)}</time>,
  };
  const selected = USAGE_RECORD_COLUMNS.filter(({ key }) => visibleColumns.includes(key));
  const minWidth = selected.reduce((width, column) => width + column.width, 0);
  const columns: TableColumn<RuntimeUsageRecord>[] = selected.map(({ key, label, width }) => ({
    key,
    header: t(`feature.usage.${label}`),
    width: `${width / minWidth * 100}%`,
    align: ['model', 'provider', 'source', 'result'].includes(key) ? 'left' : 'right',
    cell: cells[key],
  }));

  return <div style={{ '--usage-records-min-width': `${minWidth}px` } as CSSProperties}>
    <Table
      aria-label={t('feature.usage.recentCalls')}
      className="settings-usage-records__table"
      columns={columns}
      data={records}
      emptyState={<EmptyState title={t('feature.usage.empty')} />}
      getRowId={(record) => record.id}
      loading={loading}
    />
  </div>;
}

function optionalTokens(value: number | undefined): string {
  return value === undefined ? '—' : formatTokens(value);
}

function formatUsageTimestamp(value: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
