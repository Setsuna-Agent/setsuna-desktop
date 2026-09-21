import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { useEffect } from 'react';
import { runtimeErrorDisplayMessage, unwrapRuntimeErrorMessage } from '../../services/runtime-client/runtimeErrorMessages.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useToast } from '../providers/ToastProvider.js';

export function RuntimeErrorNotice({ message }: { message: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const displayMessage = runtimeErrorDisplayMessage(message, t);

  useEffect(() => {
    const id = toast.error(displayMessage);
    // The notice belongs to the current conversation; navigation must dismiss it.
    return () => { if (id !== null) toast.dismiss(id); };
  }, [displayMessage, toast]);

  return null;
}

/**
 * Turn errors are already visible in the transcript. Keep the global notice for failures that
 * have no matching message projection; navigation scoping is handled by the runtime error state.
 */
export function runtimeErrorNoticeMessage(
  error: string | null,
  thread: Pick<RuntimeThread, 'messages'> | null,
): string | null {
  const message = error?.trim();
  if (!message) return null;
  const unwrapped = unwrapRuntimeErrorMessage(message);
  const alreadyProjected = thread?.messages.some(
    (item) => item.status === 'error' && item.error && unwrapRuntimeErrorMessage(item.error) === unwrapped,
  );
  return alreadyProjected ? null : message;
}
