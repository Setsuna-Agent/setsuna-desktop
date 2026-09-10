import { Dialog } from '@setsuna-desktop/renderer-ui';
import { AlertTriangle } from 'lucide-react';
import { useWebDavSyncView } from './context.js';

type WebDavAutomaticBackupDialogProps = {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WebDavAutomaticBackupDialog({
  pending,
  onCancel,
  onConfirm,
}: WebDavAutomaticBackupDialogProps) {
  const { t, ui: { Button } } = useWebDavSyncView();
  return (
    <Dialog title={t('feature.webdavSync.automatic.confirmTitle')}
      description={t('feature.webdavSync.automatic.confirmSubtitle')}
      className="settings-webdav-automatic-dialog" width={480} dismissible={!pending} onClose={onCancel}
      footer={(<div className="settings-webdav-automatic-dialog__footer">
          <Button disabled={pending} onClick={onCancel}>{t('feature.webdavSync.common.cancel')}</Button>
          <Button disabled={pending} variant="primary" onClick={onConfirm}>
            {t(pending
              ? 'feature.webdavSync.automatic.enabling'
              : 'feature.webdavSync.automatic.confirmAction')}
          </Button>
        </div>)}>
        <div className="settings-webdav-automatic-dialog__body">
          <p>{t('feature.webdavSync.automatic.confirmDescription')}</p>
          <div className="settings-webdav-automatic-dialog__notice">
            <AlertTriangle aria-hidden="true" size={16} />
            <span>{t('feature.webdavSync.automatic.confirmWarning')}</span>
          </div>
        </div>

    </Dialog>
  );
}
