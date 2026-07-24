import type {
  DesktopDataRootState,
} from '@setsuna-desktop/contracts';
import { Modal } from 'antd';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ShellFrame } from '../../../app/layout/ShellFrame.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button } from '../../../shared/ui/primitives.js';
import { retainedBackupErrorMessage } from './dataRootBackupMessages.js';
import { RetainedDataRootBackupList } from './RetainedDataRootBackupList.js';
import { useRetainedBackupInspections } from './useRetainedBackupInspections.js';

type NormalDataRootState = Extract<DesktopDataRootState, { mode: 'normal' }>;

export function DataMigrationCleanupPage({ state }: { state: NormalDataRootState }) {
  const { t } = useI18n();
  const backups = useMemo(
    () => state.retainedBackups.filter((backup) => backup.promptOnStartup),
    [state.retainedBackups],
  );
  const inspections = useRetainedBackupInspections(backups);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allReady = backups.length > 0
    && backups.every((backup) => inspections[backup.id]?.status === 'ready');

  const keepBackups = async () => {
    const api = window.setsunaDesktop?.dataRoot;
    if (!api) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.dismissRetainedBackups(backups.map((backup) => backup.id));
      if (!result.ok) setError(retainedBackupErrorMessage(result.error.code, t));
    } catch {
      setError(t('dataRoot.backup.error.generic'));
    } finally {
      setPending(false);
    }
  };

  const deleteBackups = async () => {
    const api = window.setsunaDesktop?.dataRoot;
    if (!api) return;
    setPending(true);
    setError(null);
    try {
      for (const backup of backups) {
        const result = await api.deleteRetainedBackup(backup.id);
        if (!result.ok) {
          setError(retainedBackupErrorMessage(result.error.code, t));
          return;
        }
      }
      setConfirmOpen(false);
    } catch {
      setError(t('dataRoot.backup.error.generic'));
    } finally {
      setPending(false);
    }
  };

  return (
    <ShellFrame
      className="data-root-maintenance-shell"
      showSidebarToggle={false}
      inspectorOpen={false}
    >
      <main className="data-root-maintenance">
        <section className="data-root-maintenance__card data-root-cleanup">
          <header className="data-root-maintenance__header">
            <span className="data-root-maintenance__icon is-success">
              <CheckCircle2 size={22} />
            </span>
            <div>
              <h1>{t('dataRoot.cleanup.title')}</h1>
              <p>{t('dataRoot.cleanup.description')}</p>
            </div>
          </header>

          <div className="data-root-cleanup__active">
            <span>{t('dataRoot.cleanup.activeLocation')}</span>
            <code title={state.activeRoot}>{state.activeRoot}</code>
          </div>

          <RetainedDataRootBackupList backups={backups} inspections={inspections} />

          <p className="data-root-maintenance__notice">{t('dataRoot.cleanup.notice')}</p>
          {error ? <div className="data-root-maintenance__error" role="alert">{error}</div> : null}
          <div className="data-root-maintenance__actions">
            <Button disabled={pending} onClick={() => void keepBackups()}>
              {t('dataRoot.cleanup.keep')}
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={15} />}
              disabled={pending || !allReady}
              onClick={() => setConfirmOpen(true)}
            >
              {t('dataRoot.cleanup.deleteAndFinish')}
            </Button>
          </div>
        </section>
      </main>

      <Modal
        centered
        width={600}
        open={confirmOpen}
        title={t('dataRoot.cleanup.confirmTitle')}
        closable={!pending}
        maskClosable={!pending}
        onCancel={() => setConfirmOpen(false)}
        footer={(
          <div className="data-root-plan__actions">
            <Button disabled={pending} onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => void deleteBackups()}
            >
              {pending ? t('common.processing') : t('dataRoot.cleanup.confirmDelete')}
            </Button>
          </div>
        )}
      >
        <div className="data-root-cleanup-confirm">
          <p>{t('dataRoot.cleanup.confirmDescription')}</p>
          <div className="data-root-cleanup-confirm__paths">
            {backups.map((backup) => <code key={backup.id}>{backup.path}</code>)}
          </div>
          <strong>{t('dataRoot.cleanup.irreversible')}</strong>
        </div>
      </Modal>
    </ShellFrame>
  );
}
