import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncRestorePlan,
  DesktopWebDavSyncSnapshotSummary,
} from '@setsuna-desktop/contracts';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button } from '../../../shared/ui/primitives.js';
import { WebDavRestorePlanDialog } from './WebDavRestorePlanDialog.js';
import { formatSyncBytes, webDavCategoryCopy } from './webDavSyncCopy.js';

export function WebDavRestorePanel({
  backup,
  busy,
  onInspect,
  onRefresh,
  onRestore,
  restoreStatus,
}: {
  backup: DesktopWebDavSyncSnapshotSummary | null;
  busy: boolean;
  onInspect: (snapshotId: string, categories: DesktopWebDavSyncCategoryId[]) => Promise<DesktopWebDavSyncRestorePlan>;
  onRefresh: () => Promise<void>;
  onRestore: (planId: string) => Promise<void>;
  restoreStatus?: string;
}) {
  const { locale, t } = useI18n();
  const [selectedCategories, setSelectedCategories] = useState<DesktopWebDavSyncCategoryId[]>([]);
  const [plan, setPlan] = useState<DesktopWebDavSyncRestorePlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restorePending, setRestorePending] = useState(false);

  useEffect(() => {
    setSelectedCategories(backup?.categories.map((category) => category.id) ?? []);
    setPlan(null);
    setConfirmed(false);
    setActionError(null);
    setRestorePending(false);
  }, [backup]);

  const inspect = async () => {
    if (!backup || !selectedCategories.length) return;
    setActionError(null);
    try {
      setPlan(await onInspect(backup.id, selectedCategories));
      setConfirmed(false);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const restore = async () => {
    if (!plan || !confirmed) return;
    setActionError(null);
    setRestorePending(true);
    try {
      await onRestore(plan.id);
    } catch (error) {
      setActionError(errorMessage(error));
      setRestorePending(false);
    }
  };

  return (
    <section className="settings-webdav__card settings-webdav__restore-card">
      <header className="settings-webdav__section-header">
        <div>
          <strong>{t('settings.sync.restore.title')}</strong>
          <small>{t('settings.sync.restore.description')}</small>
        </div>
        <Button
          disabled={busy}
          icon={<RefreshCw size={13} />}
          onClick={() => void onRefresh().catch((error) => setActionError(errorMessage(error)))}
        >
          {t('settings.sync.restore.refresh')}
        </Button>
      </header>

      {backup ? (
        <>
          <div className="settings-webdav__restore-group">
            <strong>{t('settings.sync.restore.snapshot')}</strong>
            <div className="settings-webdav__snapshot-list">
              <article className="settings-webdav__snapshot is-selected">
                <span>
                  <strong>{new Date(backup.createdAt).toLocaleString(locale)}</strong>
                  <small>{t('settings.sync.restore.fromDevice', { device: backup.deviceName })}</small>
                </span>
                <small>{t('settings.sync.restore.backupSummary', {
                  categories: backup.categories.length,
                  size: formatSyncBytes(backup.totalBytes, locale),
                })}</small>
              </article>
            </div>
          </div>
          <div className="settings-webdav__restore-group">
            <strong>{t('settings.sync.restore.categories')}</strong>
            <div className="settings-webdav__restore-categories">
              {backup.categories.map((category) => (
                <label key={category.id}>
                  <input
                    checked={selectedCategories.includes(category.id)}
                    disabled={busy}
                    type="checkbox"
                    onChange={(event) => {
                      setPlan(null);
                      setSelectedCategories((current) => event.currentTarget.checked
                        ? [...current, category.id]
                        : current.filter((id) => id !== category.id));
                    }}
                  />
                  <span>
                    <strong>{t(webDavCategoryCopy[category.id].labelKey)}</strong>
                    <small>{t('settings.sync.restore.categorySummary', {
                      size: formatSyncBytes(category.totalBytes, locale),
                    })}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="settings-webdav__restore-actions">
            <Button
              disabled={busy || !selectedCategories.length}
              icon={<RotateCcw size={13} />}
              variant="primary"
              onClick={() => void inspect()}
            >
              {t('settings.sync.restore.inspect')}
            </Button>
          </div>
        </>
      ) : (
        <div className="settings-webdav__empty">{t('settings.sync.restore.empty')}</div>
      )}
      {actionError && !plan ? <div className="settings-webdav__error" role="alert">{actionError}</div> : null}
      {plan ? (
        <WebDavRestorePlanDialog
          busy={busy || restorePending}
          confirmed={confirmed}
          error={actionError}
          plan={plan}
          restoring={restorePending}
          restoreStatus={restoreStatus ?? t('settings.sync.restore.starting')}
          onClose={() => {
            if (busy || restorePending) return;
            setPlan(null);
            setConfirmed(false);
            setActionError(null);
          }}
          onConfirm={setConfirmed}
          onRestore={() => void restore()}
        />
      ) : null}
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
