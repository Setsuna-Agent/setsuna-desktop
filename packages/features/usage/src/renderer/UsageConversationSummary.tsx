import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { CircleGauge } from 'lucide-react';
import { useMemo } from 'react';
import { useUsageRendererContext, useUsageThreadState } from './context.js';
import { chatThreadUsageForDisplay } from './thread-usage.js';
import { formatTokens } from './usage/usage-format.js';
import './conversation-summary.css';

export function UsageConversationSummary({ thread }: Readonly<{ thread: RuntimeThread }>) {
  const { host: { Tooltip }, translate } = useUsageRendererContext();
  const state = useUsageThreadState(thread.id);
  const usage = useMemo(
    () => chatThreadUsageForDisplay(state.usage, thread),
    [state.usage, thread],
  );
  const summary = usage?.summary;
  const input = summary?.inputTokens ?? 0;
  const cached = summary?.cachedInputTokens ?? 0;
  const total = summary?.totalTokens ?? 0;
  const calls = summary?.recordCount ?? 0;
  const totalTokensLabel = formatTokens(total);
  const cacheHitRateLabel = formatCacheHitRate(cached, input);
  const callCountLabel = translate(
    calls === 1
      ? 'feature.usage.conversation.callCount.one'
      : 'feature.usage.conversation.callCount.many',
    { count: calls },
  );

  return (
    <div className="chat-conversation-overview-panel__row chat-conversation-overview-panel__row--static">
      <span className="chat-conversation-overview-panel__icon"><CircleGauge size={14} /></span>
      <span className="chat-conversation-overview-panel__label">
        {translate('feature.usage.conversation.usageDiagnostics')}
      </span>
      <Tooltip
        title={(
          <div className="chat-conversation-overview-usage-tooltip">
            <UsageTooltipMetric
              label={translate('feature.usage.conversation.tooltip.totalTokens')}
              value={totalTokensLabel}
            />
            <UsageTooltipMetric
              label={translate('feature.usage.conversation.tooltip.cacheHitRate')}
              value={cacheHitRateLabel}
            />
            <UsageTooltipMetric
              label={translate('feature.usage.conversation.tooltip.callCount')}
              value={callCountLabel}
            />
          </div>
        )}
      >
        <span className="chat-conversation-overview-panel__meta" title={state.error ?? undefined}>
          {[totalTokensLabel, cacheHitRateLabel, callCountLabel].join(' · ')}
        </span>
      </Tooltip>
    </div>
  );
}

function UsageTooltipMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="chat-conversation-overview-usage-tooltip__metric">
      <span>{label}</span>
      <span className="chat-conversation-overview-usage-tooltip__value">{value}</span>
    </div>
  );
}

function formatCacheHitRate(cachedInputTokens: number, inputTokens: number): string {
  if (!Number.isFinite(cachedInputTokens) || !Number.isFinite(inputTokens) || inputTokens <= 0) return '0%';
  const percent = Math.round((cachedInputTokens / inputTokens) * 100);
  return `${Math.min(100, Math.max(0, percent))}%`;
}
