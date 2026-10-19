import type { RuntimeUsageBucket, UsageProviderDescriptor } from '../../contracts/index.js';
import { formatShare, formatTokens } from './usage-format.js';
import { buildUsageDistribution, type UsageDistributionEntry } from './usageDistribution.js';
import { useUsageView } from './view-context.js';

type UsageBreakdownCardProps = {
  buckets: readonly RuntimeUsageBucket[];
  providers: readonly UsageProviderDescriptor[];
  variant: 'provider' | 'model';
};

export function UsageBreakdownCard({ buckets, providers, variant }: UsageBreakdownCardProps) {
  const { host: { BrandIcon }, translate: t } = useUsageView();
  const entries = buildUsageDistribution(buckets);
  const totalTokens = entries.reduce((total, entry) => total + entry.tokens, 0);
  const titleId = `settings-usage-${variant}-title`;
  const copy = variant === 'provider'
    ? { empty: t('feature.usage.noProviderUsage'), title: t('feature.usage.providerTitle'), unknown: t('feature.usage.unknownProvider') }
    : { empty: t('feature.usage.noModelUsage'), title: t('feature.usage.modelTitle'), unknown: t('feature.usage.unknownModel') };
  const entryLabel = (entry: UsageDistributionEntry) => entry.bucket
    ? entry.bucket.key || copy.unknown
    : t('feature.usage.otherBuckets', { count: entry.otherCount });

  return (
    <section className="settings-usage-card settings-usage-breakdown" aria-labelledby={titleId}>
      <header className="settings-usage-card__header">
        <span className="settings-usage-eyebrow" id={titleId}>{copy.title}</span>
        {buckets.length ? <span className="settings-usage-card__meta">{t('feature.usage.itemCount', { count: buckets.length })}</span> : null}
      </header>
      {entries.length ? (
        <>
          {/* 堆叠条展示整体占比，精确数值见下方列表。 */}
          <div className="settings-usage-breakdown__stack" aria-hidden="true">
            {entries.filter((entry) => entry.tokens > 0).map((entry) => (
              <span data-tone={entry.tone} key={entry.bucket?.key ?? 'other'} style={{ flexGrow: entry.tokens }} />
            ))}
          </div>
          <ol className="settings-usage-breakdown__list">
            {entries.map((entry) => (
              <li className="settings-usage-breakdown__item" key={entry.bucket?.key ?? 'other'}>
                <i aria-hidden="true" className="settings-usage-breakdown__swatch" data-tone={entry.tone} />
                <span className="settings-usage-breakdown__brand">
                  {entry.bucket ? (
                    <BrandIcon
                      kind={variant}
                      name={entry.bucket.key}
                      providers={providers}
                      providerId={entry.bucket.dominantProviderId}
                      providerName={entry.bucket.dominantProvider}
                    />
                  ) : null}
                </span>
                <span className="settings-usage-breakdown__name" title={entryLabel(entry)}>{entryLabel(entry)}</span>
                <span className="settings-usage-breakdown__records">{t('feature.usage.recordCount', { count: entry.recordCount })}</span>
                <strong className="settings-usage-breakdown__tokens">{formatTokens(entry.tokens)}</strong>
                <span className="settings-usage-breakdown__share">{formatShare(entry.tokens, totalTokens)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="settings-usage-card__empty">{copy.empty}</div>
      )}
    </section>
  );
}
