import { useEffect, useRef, useState } from 'react';
import type {
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  UsageProviderDescriptor,
} from '../../contracts/index.js';
import { UsageActivityCalendar } from './UsageActivityCalendar.js';
import { UsageBreakdownCard } from './UsageBreakdownCard.js';
import { UsageMetricCard } from './UsageMetricCard.js';
import { UsageRecentCalls } from './UsageRecentCalls.js';
import { UsageTimeRangeFilter } from './UsageTimeRangeFilter.js';
import { formatTokens } from './usage-format.js';
import {
  usageQueryForCustomRange,
  usageQueryForPreset,
  type UsageCustomTimeRange,
  type UsageTimePreset,
  type UsageTimeRangeId,
} from './usageTimeRange.js';
import { useUsageView } from './view-context.js';

type UsageSettingsProps = {
  providers: readonly UsageProviderDescriptor[];
  usage: RuntimeUsageResponse | null;
  onQueryUsage: (query: RuntimeUsageQuery) => Promise<RuntimeUsageResponse>;
};

export function UsageSettings({ providers, usage, onQueryUsage }: UsageSettingsProps) {
  const { locale, translate: t, ui: { PageHeading, Section } } = useUsageView();
  const [activeRange, setActiveRange] = useState<UsageTimeRangeId>('all');
  const [filteredUsage, setFilteredUsage] = useState(usage);
  const [activeQuery, setActiveQuery] = useState<RuntimeUsageQuery>({});
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const displayedUsage = activeRange === 'all' ? usage : filteredUsage;
  const summary = displayedUsage?.summary;
  const totalTokens = summary?.totalTokens ?? 0;
  const recordCount = summary?.recordCount ?? 0;

  useEffect(() => () => {
    requestVersionRef.current += 1;
  }, []);

  const loadRange = async (range: UsageTimeRangeId, query: RuntimeUsageQuery) => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setFilterLoading(true);
    setFilterError(null);
    try {
      const nextUsage = await onQueryUsage(query);
      if (requestVersionRef.current !== requestVersion) return;
      setActiveRange(range);
      setActiveQuery(query);
      setFilteredUsage(nextUsage);
    } catch {
      if (requestVersionRef.current !== requestVersion) return;
      setFilterError(t('feature.usage.rangeLoadFailed'));
    } finally {
      if (requestVersionRef.current === requestVersion) setFilterLoading(false);
    }
  };

  const selectPreset = (preset: UsageTimePreset) => {
    if (preset === 'all') {
      requestVersionRef.current += 1;
      setActiveRange('all');
      setActiveQuery({});
      setFilterLoading(false);
      setFilterError(null);
      return;
    }
    void loadRange(preset, usageQueryForPreset(preset));
  };

  const applyCustomRange = (range: UsageCustomTimeRange) => {
    const query = usageQueryForCustomRange(range);
    if (!query) {
      setFilterError(t('feature.usage.invalidRange'));
      return;
    }
    void loadRange('custom', query);
  };

  return (
    <>
      <PageHeading
        action={(
          <UsageTimeRangeFilter
            activeRange={activeRange}
            error={filterError}
            loading={filterLoading}
            onApplyCustom={applyCustomRange}
            onSelectPreset={selectPreset}
          />
        )}
        description={t('feature.usage.settings.description')}
        title={t('feature.usage.settings.title')}
      />
      <Section className="feature-usage chat-user-settings__usage-section" featureId="usage">
        <div aria-busy={filterLoading}>
          <div className="settings-usage-summary" aria-label={t('feature.usage.overview')}>
            <UsageMetricCard
              detail={t('feature.usage.providersAndModels', { providers: summary?.byProvider.length ?? 0, models: summary?.byModel.length ?? 0 })}
              label={t('feature.usage.totalTokens')}
              value={formatTokens(totalTokens)}
            />
            <UsageMetricCard
              detail={t('feature.usage.shareOfTotal', { ratio: formatRatio(summary?.inputTokens ?? 0, totalTokens) })}
              label={t('feature.usage.inputTokens')}
              value={formatTokens(summary?.inputTokens ?? 0)}
            />
            <UsageMetricCard
              detail={t('feature.usage.inputHitRate', { ratio: formatRatio(summary?.cachedInputTokens ?? 0, summary?.inputTokens ?? 0) })}
              label={t('feature.usage.cacheHit')}
              value={formatTokens(summary?.cachedInputTokens ?? 0)}
            />
            <UsageMetricCard
              detail={t('feature.usage.shareOfTotal', { ratio: formatRatio(summary?.outputTokens ?? 0, totalTokens) })}
              label={t('feature.usage.outputTokens')}
              value={formatTokens(summary?.outputTokens ?? 0)}
            />
            <UsageMetricCard
              detail={t('feature.usage.averagePerCall', { tokens: formatTokens(recordCount ? totalTokens / recordCount : 0) })}
              label={t('feature.usage.calls')}
              value={recordCount.toLocaleString(locale)}
            />
          </div>

          {/* 年度热力图用于观察长期趋势，不随上方的短区间统计筛选。 */}
          <UsageActivityCalendar buckets={usage?.summary.byDay ?? []} />

          <div className="settings-usage-breakdowns">
            <UsageBreakdownCard buckets={summary?.byProvider ?? []} providers={providers} totalTokens={totalTokens} variant="provider" />
            <UsageBreakdownCard buckets={summary?.byModel ?? []} providers={providers} totalTokens={totalTokens} variant="model" />
          </div>

          <UsageRecentCalls
            providers={providers}
            query={activeQuery}
            records={displayedUsage?.records ?? []}
            totalRecordCount={recordCount}
            onQueryUsage={onQueryUsage}
          />
        </div>
      </Section>
    </>
  );
}

function formatRatio(value: number, total: number): string {
  if (!total || !Number.isFinite(value)) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}
