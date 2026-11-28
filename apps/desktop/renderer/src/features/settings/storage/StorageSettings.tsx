import { ToastNotice } from '@setsuna-desktop/renderer-ui';
import { Brush, MessagesSquare, PenTool } from 'lucide-react';
import { useState } from 'react';
import { useDesktopDataRoot } from '../../../app/providers/DesktopDataRootProvider.js';
import { useDesignClient } from '../../../composition/design/design-client-context.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { SettingsGroup, SettingsNavigationRow, SettingsSection } from '../../../shared/ui/SettingsViewUi.js';
import { StorageCachesDialog, StorageHistoryDialog } from './StorageCleanupDialogs.js';
import { StorageDesignDialog } from './StorageDesignDialog.js';
import { StorageUsageOverview } from './StorageUsageOverview.js';
import { useStorageManagement } from './useStorageManagement.js';

export function StorageSettings() {
  const { state } = useDesktopDataRoot();
  const dataRoot = state?.mode === 'normal' ? state.activeRoot : undefined;
  // A root change must also discard cleanup selections and pending page requests.
  return <StorageSettingsContent key={dataRoot ?? 'unavailable'} dataRoot={dataRoot} />;
}

function StorageSettingsContent({ dataRoot }: { dataRoot?: string }) {
  const { t } = useI18n();
  const design = useDesignClient();
  const { usage, threads, threadsReady, loading, working, error, cleanup, refresh, refreshAfterCleanup } = useStorageManagement(dataRoot);
  const [dialog, setDialog] = useState<'history' | 'caches' | 'design' | null>(null);
  const closeDialog = () => setDialog(null);

  return <SettingsSection className="storage-page">
    <StorageUsageOverview usage={usage} loading={loading} disabled={working}
      dataRoot={dataRoot} onRefresh={refresh} />
    <SettingsGroup>
      <SettingsNavigationRow label={t('storage.cleanHistory')}
        icon={<MessagesSquare size={14} aria-hidden="true" />}
        disabled={!threadsReady || working} onClick={() => setDialog('history')} />
      <SettingsNavigationRow label={t('storage.cleanDesign')}
        icon={<PenTool size={14} aria-hidden="true" />}
        disabled={working || !dataRoot || !design} onClick={() => setDialog('design')} />
      <SettingsNavigationRow label={t('storage.cachesAndLogs')}
        icon={<Brush size={14} aria-hidden="true" />}
        disabled={working || !usage} onClick={() => setDialog('caches')} />
    </SettingsGroup>
    {error && !dialog ? <ToastNotice message={error} /> : null}
    {dialog === 'history' ? <StorageHistoryDialog threads={threads} working={working} error={error}
      onCleanup={cleanup} onClose={closeDialog} /> : null}
    {dialog === 'design' && design ? <StorageDesignDialog client={design} onChange={refreshAfterCleanup} onClose={closeDialog} /> : null}
    {dialog === 'caches' && usage ? <StorageCachesDialog usage={usage} working={working} error={error}
      onCleanup={cleanup} onClose={closeDialog} /> : null}
  </SettingsSection>;
}
