import type { RuntimeThread } from '@setsuna-desktop/contracts';
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

/**
 * Turn errors are already rendered as durable assistant error blocks. Only surface errors that
 * do not have an equivalent transcript projection in the global notice to avoid duplicate UI.
 */
export function runtimeErrorNoticeMessage(
  error: string | null,
  thread: Pick<RuntimeThread, 'messages'> | null,
): string | null {
  const message = error?.trim();
  if (!message) return null;
  const alreadyProjected = thread?.messages.some(
    (item) => item.status === 'error' && item.error?.trim() === message,
  );
  return alreadyProjected ? null : message;
}
