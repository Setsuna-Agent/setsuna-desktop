import type { DesktopDataRootRetainedBackup } from '@setsuna-desktop/contracts';
import { ConfirmDialogTrigger } from '@setsuna-desktop/renderer-ui';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useDesktopDataRoot } from '../../../app/providers/DesktopDataRootProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button } from '../../../shared/ui/primitives.js';
import { retainedBackupErrorMessage } from './dataRootBackupMessages.js';
import { RetainedDataRootBackupList } from './RetainedDataRootBackupList.js';
import { useRetainedBackupInspections } from './useRetainedBackupInspections.js';

const EMPTY_BACKUPS: DesktopDataRootRetainedBackup[] = [];

export function DataRootBackupSettings() {
  const { state } = useDesktopDataRoot();
  const { t } = useI18n();
  const backups = state?.mode === 'normal' ? state.retainedBackups : EMPTY_BACKUPS;
  const inspections = useRetainedBackupInspections(backups);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!backups.length) return null;

  const deleteBackup = async (backup: DesktopDataRootRetainedBackup) => {
    const api = window.setsunaDesktop?.dataRoot;
    if (!api) return;
    setDeletingId(backup.id);
    setError(null);
    try {
      const result = await api.deleteRetainedBackup(backup.id);
      if (!result.ok) setError(retainedBackupErrorMessage(result.error.code, t));
    } catch {
      setError(t('dataRoot.backup.error.generic'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="data-root-backup-settings">
      <div className="data-root-backup-settings__heading">
        <strong>{t('dataRoot.backup.settingsTitle')}</strong>
        <span>{t('dataRoot.backup.settingsDescription')}</span>
      </div>
      <RetainedDataRootBackupList
        backups={backups}
        inspections={inspections}
        renderAction={(backup) => {
          const ready = inspections[backup.id]?.status === 'ready';
          return (
            <ConfirmDialogTrigger
              title={t('dataRoot.backup.deleteTitle')}
              description={t('dataRoot.backup.deleteDescription')}
              confirmLabel={t('dataRoot.backup.deletePermanently')}
              cancelLabel={t('common.cancel')}
              danger disabled={deletingId === backup.id}
              onConfirm={() => deleteBackup(backup)}
            >
              <Button
                variant="danger"
                icon={<Trash2 size={14} />}
                disabled={Boolean(deletingId) || !ready}
              >
                {t('common.delete')}
              </Button>
            </ConfirmDialogTrigger>
          );
        }}
      />
      {error ? <div className="chat-user-settings__runtime-error" role="alert">{error}</div> : null}
    </section>
  );
}
