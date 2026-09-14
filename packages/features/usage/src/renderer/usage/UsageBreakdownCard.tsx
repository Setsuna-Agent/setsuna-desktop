import type { RuntimeUsageBucket, UsageProviderDescriptor } from '../../contracts/index.js';
import { formatTokens, tokensExcludingCache } from './usage-format.js';
import { useUsageView } from './view-context.js';

type UsageBreakdownCardProps = {
  buckets: readonly RuntimeUsageBucket[];
  providers: readonly UsageProviderDescriptor[];
  totalTokens: number;
  variant: 'provider' | 'model';
};

export function UsageBreakdownCard({ buckets, providers, totalTokens, variant }: UsageBreakdownCardProps) {
  const { host: { BrandIcon }, translate: t } = useUsageView();
  const copy = variant === 'provider'
    ? {
        count: t('feature.usage.providerCount', { count: buckets.length }),
        empty: t('feature.usage.noProviderUsage'),
        subtitle: t('feature.usage.providerSubtitle'),
        title: t('feature.usage.providerTitle'),
      }
    : {
        count: t('feature.usage.modelCount', { count: buckets.length }),
        empty: t('feature.usage.noModelUsage'),
        subtitle: t('feature.usage.modelSubtitle'),
        title: t('feature.usage.modelTitle'),
      };
  const visibleBuckets = [...buckets].sort((a, b) => tokensExcludingCache(b) - tokensExcludingCache(a) || a.key.localeCompare(b.key)).slice(0, 6);
  const maximumTokens = Math.max(1, ...visibleBuckets.map(tokensExcludingCache));

  return (
    <section className="settings-usage-card settings-usage-breakdown" aria-labelledby={`settings-usage-${variant}-title`}>
      <header className="settings-usage-card__header settings-usage-card__header--plain">
        <div>
          <strong id={`settings-usage-${variant}-title`}>{copy.title}</strong>
          <span>{copy.subtitle}</span>
        </div>
        <span className="settings-usage-card__count">{buckets.length ? copy.count : copy.empty}</span>
      </header>
      {visibleBuckets.length ? (
        <ol className="settings-usage-breakdown__list">
          {visibleBuckets.map((bucket, index) => {
            const tokens = tokensExcludingCache(bucket);
            const share = totalTokens > 0 ? tokens / totalTokens : 0;
            return (
              <li className="settings-usage-breakdown__item" key={bucket.key}>
                <span className="settings-usage-breakdown__rank">{index + 1}</span>
                <span className="settings-usage-breakdown__brand">
                  <BrandIcon
                    kind={variant}
                    name={bucket.key}
                    providers={providers}
                    providerId={bucket.dominantProviderId}
                    providerName={bucket.dominantProvider}
                  />
                </span>
                <div className="settings-usage-breakdown__main">
                  <div className="settings-usage-breakdown__label-row">
                    <strong title={bucket.key}>{bucket.key || t(variant === 'provider' ? 'feature.usage.unknownProvider' : 'feature.usage.unknownModel')}</strong>
                    <span>{formatShare(share)}</span>
                  </div>
                  <progress aria-label={`${bucket.key} ${formatShare(share)}`} max={maximumTokens} value={tokens} />
                </div>
                <div className="settings-usage-breakdown__value">
                  <strong>{formatTokens(tokens)}</strong>
                  <span>{t('feature.usage.recordCount', { count: bucket.recordCount })}</span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="settings-usage-card__empty">{copy.empty}</div>
      )}
    </section>
  );
}

function formatShare(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  const percentage = value * 100;
  return `${percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}
