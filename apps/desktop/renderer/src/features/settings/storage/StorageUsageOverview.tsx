import type { DesktopStorageUsage } from '@setsuna-desktop/contracts';
import { Button } from '@setsuna-desktop/renderer-ui';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatDataBytes } from '../data-root/dataRootFormat.js';
import { dataRootCategoryMessageKey } from '../data-root/dataRootMessages.js';

export function StorageUsageOverview({ usage, loading, disabled, dataRoot, onRefresh }: {
  usage: DesktopStorageUsage | null;
  loading: boolean;
  disabled: boolean;
  dataRoot?: string;
  onRefresh(): void;
}) {
  const { t, locale } = useI18n();
  const categories = usage?.categories.map((category) => ({
    ...category,
    label: t(category.id === 'cache' ? 'storage.cache' : category.id === 'logs' ? 'storage.logs' : dataRootCategoryMessageKey[category.id]),
    size: formatDataBytes(category.totalBytes, locale),
  })) ?? [];

  return <section className="storage-overview" aria-busy={loading}>
    <h2>{t('storage.thisDevice')}</h2>
    <div className="storage-overview__heading">
      <strong>{t('storage.used', { size: usage ? formatDataBytes(usage.totalBytes, locale) : '—' })}</strong>
      <Button size="small" disabled={disabled || loading} loading={loading} onClick={onRefresh}>
        {t('storage.refresh')}
      </Button>
    </div>
    <div className={`storage-usage-bar${loading && !usage ? ' is-loading' : ''}`} aria-hidden="true">
      {categories.filter((category) => category.totalBytes > 0).map(({ id, totalBytes, label, size }) => (
        <span key={id} data-storage-category={id} style={{ flexGrow: totalBytes }} title={`${label} · ${size}`} />
      ))}
    </div>
    <dl className="storage-legend">
      {categories.map(({ id, label, size }) => <div key={id} data-storage-category={id}>
        <dt><span className="storage-legend__dot" />{label}</dt>
        <dd>{size}</dd>
      </div>)}
    </dl>
    {dataRoot ? <div className="storage-overview__path" title={dataRoot}>{dataRoot}</div> : null}
    {usage?.incomplete ? <p className="sd-control-error" role="alert">{t('storage.incomplete')}</p> : null}
  </section>;
}
