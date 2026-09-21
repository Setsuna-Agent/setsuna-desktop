import { AlertCircle } from 'lucide-react';
import { runtimeErrorDisplayMessage } from '../../../services/runtime-client/runtimeErrorMessages.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

/** Keep failed turns readable in history while transient notices use the shared Toast. */
export function ChatErrorMessage({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className="chat-message-error">
      <AlertCircle size={17} aria-hidden="true" />
      <span>{runtimeErrorDisplayMessage(message, t)}</span>
    </div>
  );
}
