import { Button, EmptyState, StatusBadge } from '../../shared/ui/primitives.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { DataMigrationProgressPage } from '../../features/settings/data-root/DataMigrationProgressPage.js';
import { DataRootRecoveryPage } from '../../features/settings/data-root/DataRootRecoveryPage.js';
import { useDesktopDataRoot } from '../providers/DesktopDataRootProvider.js';
import { ShellFrame } from './ShellFrame.js';

export function DesktopDataRootGate({ children }: { children: React.ReactNode }) {
  const { state, loading, error, refresh } = useDesktopDataRoot();
  const { t } = useI18n();
  if (loading) return <div className="app-blank-surface" aria-hidden="true" />;
  if (error) {
    return (
      <ShellFrame
        showSidebarToggle={false}
        inspectorOpen={false}
        status={<StatusBadge tone="danger">{t('dataRoot.status.error')}</StatusBadge>}
      >
        <EmptyState
          title={t('dataRoot.loadError')}
          body={error}
          action={<Button variant="primary" onClick={() => void refresh()}>{t('common.retry')}</Button>}
        />
      </ShellFrame>
    );
  }
  if (state?.mode === 'migrating') return <DataMigrationProgressPage state={state} />;
  if (state?.mode === 'recovery') return <DataRootRecoveryPage state={state} />;
  return children;
}
