import type { ProviderConfigState, RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { Cpu } from 'lucide-react';
import { EmptyState } from '../../primitives.js';
import { formatTokens } from '../../workspace/model.js';
import { BrandIconMark } from '../BrandIconMark.js';
import { usageModelBrand, usageProviderBrand } from './usageBranding.js';

type UsageRecentCallsProps = {
  providers: ProviderConfigState[];
  records: RuntimeUsageRecord[];
  totalRecordCount: number;
};

const usageTimestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
});

export function UsageRecentCalls({ providers, records, totalRecordCount }: UsageRecentCallsProps) {
  const visibleRecords = records.slice(0, 10);
  return (
    <section className="settings-usage-card settings-usage-records" aria-labelledby="settings-usage-records-title">
      <header className="settings-usage-card__header">
        <span className="settings-usage-card__icon" aria-hidden="true">
          <Cpu size={16} strokeWidth={1.8} />
        </span>
        <div>
          <strong id="settings-usage-records-title">最近调用</strong>
          <span>最新的模型请求与 Token 明细</span>
        </div>
        <span className="settings-usage-card__count">{totalRecordCount ? `累计 ${totalRecordCount} 次` : '暂无记录'}</span>
      </header>
      {visibleRecords.length ? (
        <div className="settings-usage-records__scroller">
          <table>
            <thead>
              <tr>
                <th scope="col">模型</th>
                <th scope="col">厂商</th>
                <th scope="col">Token</th>
                <th scope="col">调用时间</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => (
                <tr key={record.id}>
                  <td>
                    <div className="settings-usage-records__model">
                      <span className="settings-usage-records__model-icon">
                        <BrandIconMark
                          brand={usageModelBrand(providers, record.model ?? '', record.providerId, record.provider)}
                          fallbackName={record.model || 'unknown model'}
                          size="compact"
                        />
                      </span>
                      <strong title={record.model}>{record.model || 'unknown model'}</strong>
                    </div>
                  </td>
                  <td>
                    <span className="settings-usage-records__provider" title={record.provider}>
                      <BrandIconMark
                        brand={usageProviderBrand(providers, record.provider ?? '', record.providerId)}
                        fallbackName={record.provider || 'unknown provider'}
                        size="compact"
                      />
                      <span>{record.provider || 'unknown provider'}</span>
                    </span>
                  </td>
                  <td>
                    <strong className="settings-usage-records__tokens">{formatTokens(record.totalTokens ?? 0)}</strong>
                    <small>{`输入 ${formatTokens(record.inputTokens ?? 0)} · 缓存 ${formatTokens(record.cachedInputTokens ?? 0)} · 输出 ${formatTokens(record.outputTokens ?? 0)}`}</small>
                  </td>
                  <td><time dateTime={record.createdAt}>{formatUsageTimestamp(record.createdAt)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="暂无用量记录" />
      )}
    </section>
  );
}

function formatUsageTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : usageTimestampFormatter.format(date);
}
