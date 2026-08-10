import { AlertTriangle, Clock3, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { Button, IconButton } from '../../../shared/ui/primitives.js';

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
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null,
  );

  useEffect(() => () => previousFocusRef.current?.focus(), []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel, pending]);

  const dialog = (
    <div
      className="desktop-agent-modal-backdrop settings-webdav-automatic-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!pending) onCancel();
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="desktop-agent-modal settings-webdav-automatic-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-webdav-automatic-dialog__header">
          <div className="settings-webdav-automatic-dialog__title">
            <span aria-hidden="true"><Clock3 size={16} /></span>
            <div>
              <strong id={titleId}>{t('settings.sync.automatic.confirmTitle')}</strong>
              <small>{t('settings.sync.automatic.confirmSubtitle')}</small>
            </div>
          </div>
          <IconButton disabled={pending} label={t('common.close')} onClick={onCancel}>
            <X size={15} />
          </IconButton>
        </header>

        <div className="settings-webdav-automatic-dialog__body">
          <p id={descriptionId}>{t('settings.sync.automatic.confirmDescription')}</p>
          <div className="settings-webdav-automatic-dialog__notice">
            <AlertTriangle aria-hidden="true" size={16} />
            <span>{t('settings.sync.automatic.confirmWarning')}</span>
          </div>
        </div>

        <footer className="settings-webdav-automatic-dialog__footer">
          <Button autoFocus disabled={pending} onClick={onCancel}>{t('common.cancel')}</Button>
          <Button disabled={pending} variant="primary" onClick={onConfirm}>
            {t(pending
              ? 'settings.sync.automatic.enabling'
              : 'settings.sync.automatic.confirmAction')}
          </Button>
        </footer>
      </section>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
