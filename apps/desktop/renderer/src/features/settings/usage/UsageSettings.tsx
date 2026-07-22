import type { ProviderConfigState, RuntimeUsageResponse } from '@setsuna-desktop/contracts';
import { ArrowDownToLine, ArrowUpFromLine, Database, Hash, Zap } from 'lucide-react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatTokens } from '../../workspace/model.js';
import { UsageActivityCalendar } from './UsageActivityCalendar.js';
import { UsageBreakdownCard } from './UsageBreakdownCard.js';
import { UsageMetricCard } from './UsageMetricCard.js';
import { UsageRecentCalls } from './UsageRecentCalls.js';

type UsageSettingsProps = {
  providers: ProviderConfigState[];
  usage: RuntimeUsageResponse | null;
};

export function UsageSettings({ providers, usage }: UsageSettingsProps) {
  const { locale, t } = useI18n();
  const summary = usage?.summary;
  const totalTokens = summary?.totalTokens ?? 0;
  const recordCount = summary?.recordCount ?? 0;
  return (
    <div className="chat-user-settings__section chat-user-settings__usage-section">
      <div className="settings-usage-summary" aria-label={t('settings.usage.overview')}>
        <UsageMetricCard
          detail={t('settings.usage.providersAndModels', { providers: summary?.byProvider.length ?? 0, models: summary?.byModel.length ?? 0 })}
          icon={Database}
          label={t('settings.usage.totalTokens')}
          tone="total"
          value={formatTokens(totalTokens)}
        />
        <UsageMetricCard
          detail={t('settings.usage.shareOfTotal', { ratio: formatRatio(summary?.inputTokens ?? 0, totalTokens) })}
          icon={ArrowDownToLine}
          label={t('settings.usage.inputTokens')}
          tone="input"
          value={formatTokens(summary?.inputTokens ?? 0)}
        />
        <UsageMetricCard
          detail={t('settings.usage.inputHitRate', { ratio: formatRatio(summary?.cachedInputTokens ?? 0, summary?.inputTokens ?? 0) })}
          icon={Zap}
          label={t('settings.usage.cacheHit')}
          tone="cache"
          value={formatTokens(summary?.cachedInputTokens ?? 0)}
        />
        <UsageMetricCard
          detail={t('settings.usage.shareOfTotal', { ratio: formatRatio(summary?.outputTokens ?? 0, totalTokens) })}
          icon={ArrowUpFromLine}
          label={t('settings.usage.outputTokens')}
          tone="output"
          value={formatTokens(summary?.outputTokens ?? 0)}
        />
        <UsageMetricCard
          detail={t('settings.usage.averagePerCall', { tokens: formatTokens(recordCount ? totalTokens / recordCount : 0) })}
          icon={Hash}
          label={t('settings.usage.calls')}
          tone="calls"
          value={recordCount.toLocaleString(locale)}
        />
      </div>

      <UsageActivityCalendar buckets={summary?.byDay ?? []} />

      <div className="settings-usage-breakdowns">
        <UsageBreakdownCard buckets={summary?.byProvider ?? []} providers={providers} totalTokens={totalTokens} variant="provider" />
        <UsageBreakdownCard buckets={summary?.byModel ?? []} providers={providers} totalTokens={totalTokens} variant="model" />
      </div>

      <UsageRecentCalls providers={providers} records={usage?.records ?? []} totalRecordCount={recordCount} />
    </div>
  );
}

function formatRatio(value: number, total: number): string {
  if (!total || !Number.isFinite(value)) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}
