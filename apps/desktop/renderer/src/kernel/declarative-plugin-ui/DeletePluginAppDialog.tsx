import { ConfirmDialog } from '@setsuna-desktop/renderer-ui';
import { useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function DeletePluginAppDialog({ name, pluginName, onClose, onRemove }: Readonly<{
  name: string;
  pluginName: string;
  onClose(): void;
  onRemove(): Promise<void>;
}>) {
  const { t } = useI18n();
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await onRemove();
      onClose();
    } catch {
      setError(t('pluginUi.deleteAppFailed'));
    } finally {
      running.current = false;
      setPending(false);
    }
  };
  return <ConfirmDialog open danger pending={pending} error={error}
    title={t('pluginUi.confirmDeleteApp', { name })}
    description={t('pluginUi.deleteAppDescription', { name: pluginName })}
    confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')}
    onClose={onClose} onConfirm={() => void remove()} />;
}
