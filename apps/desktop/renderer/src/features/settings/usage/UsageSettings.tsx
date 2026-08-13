import type {
  ProviderConfigState,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
} from '@setsuna-desktop/contracts';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatTokens } from '../../workspace/model.js';
import { SettingsPageHeading } from '../SettingsPageHeading.js';
import { UsageActivityCalendar } from './UsageActivityCalendar.js';
import { UsageBreakdownCard } from './UsageBreakdownCard.js';
import { UsageMetricCard } from './UsageMetricCard.js';
import { UsageRecentCalls } from './UsageRecentCalls.js';
import { UsageTimeRangeFilter } from './UsageTimeRangeFilter.js';
import {
  usageQueryForCustomRange,
  usageQueryForPreset,
  type UsageCustomTimeRange,
  type UsageTimePreset,
  type UsageTimeRangeId,
} from './usageTimeRange.js';

type UsageSettingsProps = {
  providers: ProviderConfigState[];
  usage: RuntimeUsageResponse | null;
  onQueryUsage: (query: RuntimeUsageQuery) => Promise<RuntimeUsageResponse>;
};

export function UsageSettings({ providers, usage, onQueryUsage }: UsageSettingsProps) {
  const { locale, t } = useI18n();
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
      setFilterError(t('settings.usage.rangeLoadFailed'));
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
      setFilterError(t('settings.usage.invalidRange'));
      return;
    }
    void loadRange('custom', query);
  };

  return (
    <>
      <SettingsPageHeading
        action={(
          <UsageTimeRangeFilter
            activeRange={activeRange}
            error={filterError}
            loading={filterLoading}
            onApplyCustom={applyCustomRange}
            onSelectPreset={selectPreset}
          />
        )}
        description={t('settings.section.usageDescription')}
        title={t('settings.section.usage')}
      />

      <div className="chat-user-settings__section chat-user-settings__usage-section" aria-busy={filterLoading}>

        <div className="settings-usage-summary" aria-label={t('settings.usage.overview')}>
          <UsageMetricCard
            detail={t('settings.usage.providersAndModels', { providers: summary?.byProvider.length ?? 0, models: summary?.byModel.length ?? 0 })}
            label={t('settings.usage.totalTokens')}
            value={formatTokens(totalTokens)}
          />
          <UsageMetricCard
            detail={t('settings.usage.shareOfTotal', { ratio: formatRatio(summary?.inputTokens ?? 0, totalTokens) })}
            label={t('settings.usage.inputTokens')}
            value={formatTokens(summary?.inputTokens ?? 0)}
          />
          <UsageMetricCard
            detail={t('settings.usage.inputHitRate', { ratio: formatRatio(summary?.cachedInputTokens ?? 0, summary?.inputTokens ?? 0) })}
            label={t('settings.usage.cacheHit')}
            value={formatTokens(summary?.cachedInputTokens ?? 0)}
          />
          <UsageMetricCard
            detail={t('settings.usage.shareOfTotal', { ratio: formatRatio(summary?.outputTokens ?? 0, totalTokens) })}
            label={t('settings.usage.outputTokens')}
            value={formatTokens(summary?.outputTokens ?? 0)}
          />
          <UsageMetricCard
            detail={t('settings.usage.averagePerCall', { tokens: formatTokens(recordCount ? totalTokens / recordCount : 0) })}
            label={t('settings.usage.calls')}
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
    </>
  );
}

function formatRatio(value: number, total: number): string {
  if (!total || !Number.isFinite(value)) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}
