import { Dialog } from '@setsuna-desktop/renderer-ui';
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

  return (
    <Dialog title={t('dialog.renameChat')} width={420} onClose={onCancel}>
      <form onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <TextField autoFocus value={title} aria-label={t('dialog.chatTitle')} placeholder={t('dialog.chatTitle')} onChange={(event) => onChange(event.target.value)} />
        <div className="sd-dialog-form-actions">
          <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!title.trim()}>{t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
