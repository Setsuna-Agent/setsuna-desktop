import { createPortal } from 'react-dom';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { Button, TextField } from '../../shared/ui/primitives.js';

export function RenameThreadDialog({
  title,
  onCancel,
  onChange,
  onSave,
}: {
  title: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();

  return createPortal(
    <div className="desktop-agent-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="desktop-agent-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('dialog.renameChat')}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <header>
          <strong>{t('dialog.renameChat')}</strong>
        </header>
        <TextField autoFocus value={title} placeholder={t('dialog.chatTitle')} onChange={(event) => onChange(event.target.value)} />
        <footer>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim()}>
            {t('common.save')}
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
