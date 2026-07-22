import type { ProviderConfigState, RuntimeUsageRecord } from '@setsuna-desktop/contracts';
import { Cpu } from 'lucide-react';
import { BrandIconMark } from '../../../shared/branding/BrandIconMark.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { EmptyState } from '../../../shared/ui/primitives.js';
import { formatTokens } from '../../workspace/model.js';
import { usageModelBrand, usageProviderBrand } from './usageBranding.js';

type UsageRecentCallsProps = {
  providers: ProviderConfigState[];
  records: RuntimeUsageRecord[];
  totalRecordCount: number;
};

export function UsageRecentCalls({ providers, records, totalRecordCount }: UsageRecentCallsProps) {
  const { locale, t } = useI18n();
  const usageTimestampFormatter = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
  });
  const visibleRecords = records.slice(0, 10);
  return (
    <section className="settings-usage-card settings-usage-records" aria-labelledby="settings-usage-records-title">
      <header className="settings-usage-card__header">
        <span className="settings-usage-card__icon" aria-hidden="true">
          <Cpu size={16} strokeWidth={1.8} />
        </span>
        <div>
          <strong id="settings-usage-records-title">{t('settings.usage.recentCalls')}</strong>
          <span>{t('settings.usage.recentCallsSubtitle')}</span>
        </div>
        <span className="settings-usage-card__count">{totalRecordCount ? t('settings.usage.totalCalls', { count: totalRecordCount }) : t('settings.usage.noRecords')}</span>
      </header>
      {visibleRecords.length ? (
        <div className="settings-usage-records__scroller">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('settings.usage.model')}</th>
                <th scope="col">{t('settings.usage.provider')}</th>
                <th scope="col">Token</th>
                <th scope="col">{t('settings.usage.callTime')}</th>
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
                          fallbackName={record.model || t('settings.usage.unknownModel')}
                          size="compact"
                        />
                      </span>
                      <strong title={record.model}>{record.model || t('settings.usage.unknownModel')}</strong>
                    </div>
                  </td>
                  <td>
                    <span className="settings-usage-records__provider" title={record.provider}>
                      <BrandIconMark
                        brand={usageProviderBrand(providers, record.provider ?? '', record.providerId)}
                        fallbackName={record.provider || t('settings.usage.unknownProvider')}
                        size="compact"
                      />
                      <span>{record.provider || t('settings.usage.unknownProvider')}</span>
                    </span>
                  </td>
                  <td>
                    <strong className="settings-usage-records__tokens">{formatTokens(record.totalTokens ?? 0)}</strong>
                    <small>{t('settings.usage.tokenDetails', {
                      input: formatTokens(record.inputTokens ?? 0),
                      cache: formatTokens(record.cachedInputTokens ?? 0),
                      output: formatTokens(record.outputTokens ?? 0),
                    })}</small>
                  </td>
                  <td><time dateTime={record.createdAt}>{formatUsageTimestamp(record.createdAt, usageTimestampFormatter)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={t('settings.usage.empty')} />
      )}
    </section>
  );
}

function formatUsageTimestamp(value: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}
