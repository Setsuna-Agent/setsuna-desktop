import type { RuntimeUsageBucket, RuntimeUsageSummary } from '../../contracts/index.js';
import { UsageTrendChart } from './UsageTrendChart.js';
import { formatShare, formatTokenParts, formatTokens, tokensExcludingCache, uncachedInputTokens } from './usage-format.js';
import { useUsageView } from './view-context.js';

type UsageHeroProps = {
  /** 当前筛选时段的人类可读名称，作为主数字的上下文。 */
  rangeLabel: string;
  summary: RuntimeUsageSummary | undefined;
  /** 全量日分桶：走势图固定展示近 30 天，不随筛选变化。 */
  trendBuckets: readonly RuntimeUsageBucket[];
};

/** 构成分段按“非缓存输入 / 缓存读取 / 输出”排列，三者之和即含缓存的原始总量。 */
type UsageCompositionPart = {
  key: 'input' | 'cache' | 'output';
  label: string;
  value: number;
};

export function UsageHero({ rangeLabel, summary, trendBuckets }: UsageHeroProps) {
  const { locale, translate: t } = useUsageView();
  const headline = formatTokenParts(tokensExcludingCache(summary));
  const cachedTokens = summary?.cachedInputTokens ?? 0;
  const parts: UsageCompositionPart[] = [
    { key: 'input', label: t('feature.usage.inputTokens'), value: uncachedInputTokens(summary) },
    { key: 'cache', label: t('feature.usage.cacheHit'), value: cachedTokens },
    { key: 'output', label: t('feature.usage.outputTokens'), value: summary?.outputTokens ?? 0 },
  ];
  const rawTotal = parts.reduce((total, part) => total + part.value, 0);

  return (
    <section className="settings-usage-hero" aria-label={t('feature.usage.overview')}>
      <div className="settings-usage-hero__summary">
        <span className="settings-usage-eyebrow">{rangeLabel}</span>
        <div className="settings-usage-hero__figure">
          <strong>{headline.value}</strong>
          {headline.unit ? <span>{headline.unit}</span> : null}
        </div>
        <p className="settings-usage-hero__caption">{t('feature.usage.heroCaption')}</p>
        <dl className="settings-usage-hero__facts">
          <div>
            <dt>{t('feature.usage.records')}</dt>
            <dd>{(summary?.recordCount ?? 0).toLocaleString(locale)}</dd>
          </div>
          <div>
            <dt>{t('feature.usage.models')}</dt>
            <dd>{summary?.byModel.length ?? 0}</dd>
          </div>
          <div>
            <dt>{t('feature.usage.cacheHitRate')}</dt>
            <dd>{formatShare(cachedTokens, summary?.inputTokens ?? 0)}</dd>
          </div>
        </dl>
        <div className="settings-usage-composition">
          {/* 分段宽度只是视觉补充，精确数值在下方图例中逐项给出。 */}
          <div className="settings-usage-composition__bar" aria-hidden="true">
            {parts.filter((part) => part.value > 0).map((part) => (
              <span data-part={part.key} key={part.key} style={{ flexGrow: part.value }} />
            ))}
          </div>
          <ul className="settings-usage-composition__legend" aria-label={t('feature.usage.composition', { tokens: formatTokens(rawTotal) })}>
            {parts.map((part) => (
              <li key={part.key}>
                <i aria-hidden="true" data-part={part.key} />
                <span>{part.label}</span>
                <strong>{formatTokens(part.value)}</strong>
                <small>{formatShare(part.value, rawTotal)}</small>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <UsageTrendChart buckets={trendBuckets} />
    </section>
  );
}
