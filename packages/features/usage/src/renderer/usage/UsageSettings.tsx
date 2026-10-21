import { useEffect, useRef, useState } from 'react';
import type {
  RuntimeUsageQuery,
  RuntimeUsageResponse,
  UsageProviderDescriptor,
} from '../../contracts/index.js';
import { UsageActivityCalendar } from './UsageActivityCalendar.js';
import { UsageBreakdownCard } from './UsageBreakdownCard.js';
import { UsageFilterBar } from './UsageFilterBar.js';
import { UsageHero } from './UsageHero.js';
import { UsageRecentCalls } from './UsageRecentCalls.js';
import { UsageSettingsLoading } from '../UsageSettingsLoading.js';
import { UsageSkeleton } from './UsageSkeleton.js';
import { usageRangeLabel } from './usage-format.js';
import {
  DEFAULT_USAGE_FILTERS,
  isDefaultUsageFilters,
  usageQueryForFilters,
  type UsageFilters,
} from './usageFilters.js';
import { useUsageView } from './view-context.js';
import { useProgressiveUsageSections } from './useProgressiveUsageSections.js';

type UsageSettingsProps = {
  providers: readonly UsageProviderDescriptor[];
  usage: RuntimeUsageResponse | null;
  onQueryUsage: (query: RuntimeUsageQuery) => Promise<RuntimeUsageResponse>;
};

export function UsageSettings({ providers, usage, onQueryUsage }: UsageSettingsProps) {
  const { translate: t, ui } = useUsageView();
  const { PageHeading, Section } = ui;
  const visible = useProgressiveUsageSections(usage !== null);
  // 选择立即更新以组合连续操作；数据保持上次成功的筛选，请求失败时还原选择。
  const [selectedFilters, setSelectedFilters] = useState<UsageFilters>(DEFAULT_USAGE_FILTERS);
  const [filters, setFilters] = useState<UsageFilters>(DEFAULT_USAGE_FILTERS);
  const [filteredUsage, setFilteredUsage] = useState(usage);
  const [activeQuery, setActiveQuery] = useState<RuntimeUsageQuery>({});
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const unfiltered = isDefaultUsageFilters(filters);
  // 未筛选时直接使用基线快照，使会话结束后的失效刷新立即反映到页面。
  const displayedUsage = unfiltered ? usage : filteredUsage;
  const summary = displayedUsage?.summary;
  const recordCount = summary?.recordCount ?? 0;

  useEffect(() => () => {
    requestVersionRef.current += 1;
  }, []);

  const applyFilters = async (next: UsageFilters) => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setSelectedFilters(next);
    setFilterError(null);
    if (isDefaultUsageFilters(next)) {
      setFilters(next);
      setActiveQuery({});
      setFilterLoading(false);
      return;
    }
    setFilterLoading(true);
    const query = usageQueryForFilters(next);
    try {
      const nextUsage = await onQueryUsage(query);
      if (requestVersionRef.current !== requestVersion) return;
      setFilters(next);
      setActiveQuery(query);
      setFilteredUsage(nextUsage);
    } catch {
      if (requestVersionRef.current !== requestVersion) return;
      setSelectedFilters(filters);
      setFilterError(t('feature.usage.rangeLoadFailed'));
    } finally {
      if (requestVersionRef.current === requestVersion) setFilterLoading(false);
    }
  };

  if (!usage) return <UsageSettingsLoading translate={t} ui={ui} />;

  return (
    <>
      <PageHeading
        action={(
          <UsageFilterBar
            error={filterError}
            filters={selectedFilters}
            modelBuckets={usage?.summary.byModel ?? []}
            providerBuckets={usage?.summary.byProvider ?? []}
            providers={providers}
            onChange={(next) => void applyFilters(next)}
          />
        )}
        description={t('feature.usage.settings.description')}
        title={t('feature.usage.settings.title')}
      />
      <Section className="feature-usage chat-user-settings__usage-section" featureId="usage">
        <div className="settings-usage-content" aria-busy={filterLoading}>
          {/* 主数字、分布与明细随筛选变化；走势与年度热力图始终基于全部数据，用于观察长期趋势。 */}
          <UsageHero
            rangeLabel={usageRangeLabel(filters.range, t)}
            summary={summary}
            trendBuckets={usage?.summary.byDay ?? []}
          />

          <div className="settings-usage-breakdowns">
            {visible.breakdowns ? <>
              <UsageBreakdownCard buckets={summary?.byModel ?? []} providers={providers} variant="model" />
              <UsageBreakdownCard buckets={summary?.byProvider ?? []} providers={providers} variant="provider" />
            </> : <><UsageSkeleton kind="breakdown" /><UsageSkeleton kind="breakdown" /></>}
          </div>

          {visible.calendar ? <UsageActivityCalendar buckets={usage.summary.byDay} /> : <UsageSkeleton kind="calendar" />}

          {visible.records ? <UsageRecentCalls
            providers={providers}
            query={activeQuery}
            records={displayedUsage?.records ?? []}
            totalRecordCount={recordCount}
            onQueryUsage={onQueryUsage}
          /> : <UsageSkeleton kind="records" />}
        </div>
      </Section>
    </>
  );
}
