import { Button } from 'antd';
import { Cable, X } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function ChatModelSetupNotice({
  onConfigure,
  onDismiss,
}: {
  onConfigure: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="chat-starter__model-setup-notice" role="status">
      <Cable className="chat-starter__model-setup-notice-icon" size={16} strokeWidth={1.8} aria-hidden="true" />
      <div className="chat-starter__model-setup-notice-body">
        <strong className="chat-starter__model-setup-notice-title">{t('chat.modelSetup.title')}</strong>
        <span className="chat-starter__model-setup-notice-description">{t('chat.modelSetup.description')}</span>
      </div>
      <Button size="small" type="primary" onClick={onConfigure}>
        {t('chat.modelSetup.configure')}
      </Button>
      <button
        aria-label={t('chat.modelSetup.dismiss')}
        className="chat-starter__model-setup-notice-dismiss"
        type="button"
        onClick={onDismiss}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
