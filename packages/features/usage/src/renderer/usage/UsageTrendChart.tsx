import type { CSSProperties } from 'react';
import type { RuntimeUsageBucket } from '../../contracts/index.js';
import { formatTokens, usageDayDetails } from './usage-format.js';
import { parseDateKey } from './usageDates.js';
import { buildUsageTrend } from './usageTrend.js';
import { useUsageView } from './view-context.js';

type UsageTrendChartProps = {
  buckets: readonly RuntimeUsageBucket[];
};

/** 近 30 天每日柱状走势；与年度热力图一样始终基于全部数据，不随时段筛选变化。 */
export function UsageTrendChart({ buckets }: UsageTrendChartProps) {
  const { host: { Tooltip }, locale, translate: t } = useUsageView();
  const trend = buildUsageTrend(buckets);
  const dayFormatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const shortFormatter = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const peakDate = trend.peak ? parseDateKey(trend.peak.dateKey) : null;

  return (
    <div className="settings-usage-trend">
      <div className="settings-usage-trend__header">
        <span>{t('feature.usage.trendTitle')}</span>
        <span>
          {trend.peak && peakDate
            ? t('feature.usage.trendPeak', { date: shortFormatter.format(peakDate), tokens: formatTokens(trend.peak.totalTokens) })
            : t('feature.usage.trendEmpty')}
        </span>
      </div>
      <div className="settings-usage-trend__bars" role="img" aria-label={t('feature.usage.trendChart', { tokens: formatTokens(trend.totalTokens) })}>
        {trend.points.map((point) => (
          <Tooltip key={point.dateKey} title={usageDayDetails(point, dayFormatter, t)}>
            <span
              aria-hidden="true"
              className="settings-usage-trend__bar"
              data-peak={point === trend.peak || undefined}
              style={{ '--settings-usage-bar-ratio': point.ratio } as CSSProperties}
            />
          </Tooltip>
        ))}
      </div>
      <div className="settings-usage-trend__axis" aria-hidden="true">
        <span>{formatAxisDate(trend.points[0]?.dateKey, shortFormatter)}</span>
        <span>{t('feature.usage.today')}</span>
      </div>
    </div>
  );
}

function formatAxisDate(dateKey: string | undefined, formatter: Intl.DateTimeFormat): string {
  const date = dateKey ? parseDateKey(dateKey) : null;
  return date ? formatter.format(date) : '';
}
