import type { ProviderConfigState, RuntimeUsageBucket } from '@setsuna-desktop/contracts';
import { Boxes, Building2 } from 'lucide-react';
import { BrandIconMark } from '../../../shared/branding/BrandIconMark.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatTokens } from '../../workspace/model.js';
import { usageModelBrand, usageProviderBrand } from './usageBranding.js';

type UsageBreakdownCardProps = {
  buckets: RuntimeUsageBucket[];
  providers: ProviderConfigState[];
  totalTokens: number;
  variant: 'provider' | 'model';
};

export function UsageBreakdownCard({ buckets, providers, totalTokens, variant }: UsageBreakdownCardProps) {
  const { t } = useI18n();
  const copy = variant === 'provider'
    ? {
        count: t('settings.usage.providerCount', { count: buckets.length }),
        empty: t('settings.usage.noProviderUsage'),
        subtitle: t('settings.usage.providerSubtitle'),
        title: t('settings.usage.providerTitle'),
      }
    : {
        count: t('settings.usage.modelCount', { count: buckets.length }),
        empty: t('settings.usage.noModelUsage'),
        subtitle: t('settings.usage.modelSubtitle'),
        title: t('settings.usage.modelTitle'),
      };
  const Icon = variant === 'provider' ? Building2 : Boxes;
  const visibleBuckets = buckets.slice(0, 6);
  const maximumTokens = Math.max(1, ...visibleBuckets.map((bucket) => bucket.totalTokens));

  return (
    <section className="settings-usage-card settings-usage-breakdown" aria-labelledby={`settings-usage-${variant}-title`}>
      <header className="settings-usage-card__header">
        <span className="settings-usage-card__icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <div>
          <strong id={`settings-usage-${variant}-title`}>{copy.title}</strong>
          <span>{copy.subtitle}</span>
        </div>
        <span className="settings-usage-card__count">{buckets.length ? copy.count : copy.empty}</span>
      </header>
      {visibleBuckets.length ? (
        <ol className="settings-usage-breakdown__list">
          {visibleBuckets.map((bucket, index) => {
            const share = totalTokens > 0 ? bucket.totalTokens / totalTokens : 0;
            return (
              <li className="settings-usage-breakdown__item" key={bucket.key}>
                <span className="settings-usage-breakdown__rank">{index + 1}</span>
                <span className="settings-usage-breakdown__brand">
                  <BrandIconMark
                    brand={variant === 'provider'
                      ? usageProviderBrand(providers, bucket.key)
                      : usageModelBrand(
                          providers,
                          bucket.key,
                          bucket.dominantProviderId,
                          bucket.dominantProvider,
                        )}
                    fallbackName={bucket.key}
                    size="compact"
                  />
                </span>
                <div className="settings-usage-breakdown__main">
                  <div className="settings-usage-breakdown__label-row">
                    <strong title={bucket.key}>{bucket.key || t(variant === 'provider' ? 'settings.usage.unknownProvider' : 'settings.usage.unknownModel')}</strong>
                    <span>{formatShare(share)}</span>
                  </div>
                  <progress aria-label={`${bucket.key} ${formatShare(share)}`} max={maximumTokens} value={bucket.totalTokens} />
                </div>
                <div className="settings-usage-breakdown__value">
                  <strong>{formatTokens(bucket.totalTokens)}</strong>
                  <span>{t('settings.usage.callCount', { count: bucket.recordCount })}</span>
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
