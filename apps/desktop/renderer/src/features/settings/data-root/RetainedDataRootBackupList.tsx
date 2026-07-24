import type {
  DesktopDataRootRetainedBackup,
} from '@setsuna-desktop/contracts';
import { Archive, AlertTriangle, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { formatDataBytes } from './dataRootFormat.js';
import { retainedBackupErrorMessage } from './dataRootBackupMessages.js';
import type { RetainedBackupInspections } from './useRetainedBackupInspections.js';

type RetainedDataRootBackupListProps = {
  backups: readonly DesktopDataRootRetainedBackup[];
  inspections: RetainedBackupInspections;
  renderAction?: (backup: DesktopDataRootRetainedBackup) => ReactNode;
};

export function RetainedDataRootBackupList({
  backups,
  inspections,
  renderAction,
}: RetainedDataRootBackupListProps) {
  const { locale, t } = useI18n();
  return (
    <div className="data-root-backup-list" role="list">
      {backups.map((backup) => {
        const inspection = inspections[backup.id];
        const ready = inspection?.status === 'ready';
        return (
          <article className="data-root-backup-item" key={backup.id} role="listitem">
            <span className="data-root-backup-item__icon" aria-hidden="true">
              {inspection
                ? inspection.status === 'ready' ? <Archive size={17} /> : <AlertTriangle size={17} />
                : <LoaderCircle className="is-spinning" size={17} />}
            </span>
            <div className="data-root-backup-item__body">
              <strong>{t('dataRoot.backup.oldLocation')}</strong>
              <code title={backup.path}>{backup.path}</code>
              <span className={inspection && !ready ? 'is-warning' : ''}>
                {!inspection
                  ? t('dataRoot.backup.calculating')
                  : ready
                    ? t('dataRoot.backup.sizeAndFiles', {
                        size: formatDataBytes(inspection.totalBytes, locale),
                        files: inspection.fileCount.toLocaleString(locale),
                      })
                    : retainedBackupErrorMessage(inspection.error?.code, t)}
              </span>
            </div>
            {renderAction ? (
              <div className="data-root-backup-item__action">{renderAction(backup)}</div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
