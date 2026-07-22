import type { ProviderConfigState, RuntimeUsageResponse } from '@setsuna-desktop/contracts';
import { ArrowDownToLine, ArrowUpFromLine, Database, Hash, Zap } from 'lucide-react';
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
  const summary = usage?.summary;
  const totalTokens = summary?.totalTokens ?? 0;
  const recordCount = summary?.recordCount ?? 0;
  return (
    <div className="chat-user-settings__section chat-user-settings__usage-section">
      <div className="settings-usage-summary" aria-label="用量概览">
        <UsageMetricCard
          detail={`${summary?.byProvider.length ?? 0} 个厂商 · ${summary?.byModel.length ?? 0} 个模型`}
          icon={Database}
          label="总 Token"
          tone="total"
          value={formatTokens(totalTokens)}
        />
        <UsageMetricCard
          detail={`${formatRatio(summary?.inputTokens ?? 0, totalTokens)} 占总用量`}
          icon={ArrowDownToLine}
          label="输入 Token"
          tone="input"
          value={formatTokens(summary?.inputTokens ?? 0)}
        />
        <UsageMetricCard
          detail={`${formatRatio(summary?.cachedInputTokens ?? 0, summary?.inputTokens ?? 0)} 输入命中率`}
          icon={Zap}
          label="缓存命中"
          tone="cache"
          value={formatTokens(summary?.cachedInputTokens ?? 0)}
        />
        <UsageMetricCard
          detail={`${formatRatio(summary?.outputTokens ?? 0, totalTokens)} 占总用量`}
          icon={ArrowUpFromLine}
          label="输出 Token"
          tone="output"
          value={formatTokens(summary?.outputTokens ?? 0)}
        />
        <UsageMetricCard
          detail={`平均 ${formatTokens(recordCount ? totalTokens / recordCount : 0)} / 次`}
          icon={Hash}
          label="调用次数"
          tone="calls"
          value={recordCount.toLocaleString()}
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
