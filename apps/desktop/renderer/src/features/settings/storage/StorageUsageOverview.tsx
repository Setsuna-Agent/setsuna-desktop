import { DESKTOP_STORAGE_CATEGORY_IDS, type DesktopStorageUsage } from '@setsuna-desktop/contracts';
import { IconButton, Skeleton } from '@setsuna-desktop/renderer-ui';
import { Folder, HardDrive, RefreshCw } from 'lucide-react';
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
  const categories = DESKTOP_STORAGE_CATEGORY_IDS.map((id) => {
    const totalBytes = usage?.categories.find((category) => category.id === id)?.totalBytes ?? 0;
    return {
      id, totalBytes,
      label: t(id === 'cache' ? 'storage.cache' : id === 'logs' ? 'storage.logs' : dataRootCategoryMessageKey[id]),
      size: usage ? formatDataBytes(totalBytes, locale) : null,
    };
  });

  return <section className="storage-overview" aria-busy={loading}>
    <div className="storage-overview__body">
      <div className="storage-overview__heading">
        <div className="storage-overview__device">
          <span className="storage-overview__device-icon"><HardDrive size={22} aria-hidden="true" /></span>
          <div>
            <h2>{t('storage.thisDevice')}</h2>
            <div className="storage-overview__total">
              <strong>{usage ? formatDataBytes(usage.totalBytes, locale)
                : loading ? <Skeleton className="storage-overview__total-placeholder" /> : '—'}</strong>
              <span>{t('storage.used')}</span>
            </div>
          </div>
        </div>
        <IconButton className="storage-overview__refresh" size="small" label={t('storage.refresh')}
          disabled={disabled || loading} loading={loading} onClick={onRefresh}>
          {loading ? null : <RefreshCw size={15} aria-hidden="true" />}
        </IconButton>
      </div>
      {loading && !usage ? <Skeleton className="storage-usage-bar" /> : <div className="storage-usage-bar" aria-hidden="true">
        {categories.filter((category) => category.totalBytes > 0).map(({ id, totalBytes, label, size }) => (
          <span key={id} data-storage-category={id} style={{ flexGrow: totalBytes }} title={`${label} · ${size}`} />
        ))}
      </div>}
      <dl className="storage-legend">
        {categories.map(({ id, label, size }) => <div key={id} data-storage-category={id}>
          <dt title={label}><span className="storage-legend__dot" /><span>{label}</span></dt>
          <dd>{size ?? (loading ? <Skeleton className="storage-legend__placeholder" /> : '—')}</dd>
        </div>)}
      </dl>
      {usage?.incomplete ? <p className="sd-control-error" role="alert">{t('storage.incomplete')}</p> : null}
    </div>
    {dataRoot ? <div className="storage-overview__path" title={dataRoot}>
      <Folder size={14} aria-hidden="true" /><span>{dataRoot}</span>
    </div> : null}
  </section>;
}
