import { AlertTriangle, X } from 'lucide-react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

export function RuntimeErrorNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { t } = useI18n();

  return (
    <div className="app-runtime-error-notice" role="alert">
      <AlertTriangle aria-hidden="true" className="app-runtime-error-notice__icon" size={17} />
      <div className="app-runtime-error-notice__content">
        <strong>{t('app.error.runtime')}</strong>
        <span>{message}</span>
      </div>
      <button aria-label={t('runtimeError.close')} type="button" onClick={onDismiss}>
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

/** Runtime event failures should be visible immediately, even when also projected in the thread. */
export function runtimeErrorNoticeMessage(error: string | null): string | null {
  const message = error?.trim();
  return message || null;
}
