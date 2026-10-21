import { ToastNotice } from '@setsuna-desktop/renderer-ui';
import { useState } from 'react';
import { useDesktopDataRoot } from '../../../app/providers/DesktopDataRootProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SettingsGroup, SettingsNavigationRow, SettingsSection } from '../../../shared/ui/SettingsViewUi.js';
import { StorageCachesDialog, StorageHistoryDialog } from './StorageCleanupDialogs.js';
import { StorageUsageOverview } from './StorageUsageOverview.js';
import { useStorageManagement } from './useStorageManagement.js';

export function StorageSettings() {
  const { t } = useI18n();
  const { state } = useDesktopDataRoot();
  const { usage, threads, loading, working, error, cleanup, refresh } = useStorageManagement();
  const [dialog, setDialog] = useState<'history' | 'caches' | null>(null);
  const closeDialog = () => setDialog(null);

  return <SettingsSection className="storage-page">
    <StorageUsageOverview usage={usage} loading={loading} disabled={working}
      dataRoot={state?.mode === 'normal' ? state.activeRoot : undefined} onRefresh={refresh} />
    {/* Both entries open a review dialog before anything is deleted, so they read as navigation rows. */}
    <SettingsGroup>
      <SettingsNavigationRow label={t('storage.cleanHistory')} disabled={loading || working} onClick={() => setDialog('history')} />
      <SettingsNavigationRow label={t('storage.cachesAndLogs')} disabled={loading || working || !usage} onClick={() => setDialog('caches')} />
    </SettingsGroup>
    {error && !dialog ? <ToastNotice message={error} /> : null}
    {dialog === 'history' ? <StorageHistoryDialog threads={threads} working={working} error={error}
      onCleanup={cleanup} onClose={closeDialog} /> : null}
    {dialog === 'caches' && usage ? <StorageCachesDialog usage={usage} working={working} error={error}
      onCleanup={cleanup} onClose={closeDialog} /> : null}
  </SettingsSection>;
}
