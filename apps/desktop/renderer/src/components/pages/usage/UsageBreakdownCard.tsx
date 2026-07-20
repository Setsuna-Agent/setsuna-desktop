import type { ProviderConfigState, RuntimeUsageBucket } from '@setsuna-desktop/contracts';
import { Boxes, Building2 } from 'lucide-react';
import { formatTokens } from '../../workspace/model.js';
import { BrandIconMark } from '../BrandIconMark.js';
import { usageModelBrand, usageProviderBrand } from './usageBranding.js';

type UsageBreakdownCardProps = {
  buckets: RuntimeUsageBucket[];
  providers: ProviderConfigState[];
  totalTokens: number;
  variant: 'provider' | 'model';
};

const breakdownCopy = {
  provider: {
    countUnit: '个厂商',
    empty: '暂无厂商用量',
    subtitle: '不同模型服务的用量占比',
    title: '厂商分布',
  },
  model: {
    countUnit: '个模型',
    empty: '暂无模型用量',
    subtitle: '按 Token 消耗从高到低',
    title: '模型排行',
  },
} as const;

export function UsageBreakdownCard({ buckets, providers, totalTokens, variant }: UsageBreakdownCardProps) {
  const copy = breakdownCopy[variant];
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
        <span className="settings-usage-card__count">{buckets.length ? `${buckets.length} ${copy.countUnit}` : copy.empty}</span>
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
                      : usageModelBrand(providers, bucket.key)}
                    fallbackName={bucket.key}
                    size="compact"
                  />
                </span>
                <div className="settings-usage-breakdown__main">
                  <div className="settings-usage-breakdown__label-row">
                    <strong title={bucket.key}>{bucket.key || 'unknown'}</strong>
                    <span>{formatShare(share)}</span>
                  </div>
                  <progress aria-label={`${bucket.key} ${formatShare(share)}`} max={maximumTokens} value={bucket.totalTokens} />
                </div>
                <div className="settings-usage-breakdown__value">
                  <strong>{formatTokens(bucket.totalTokens)}</strong>
                  <span>{bucket.recordCount} 次</span>
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
