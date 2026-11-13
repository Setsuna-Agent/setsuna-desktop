import type { DesktopConversationExportFormat, DesktopRuntimeClient } from '@setsuna-desktop/contracts';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import type { ConversationExportPreview } from './exportConversation.js';

type PreparationResult = { cancelled?: boolean };

export function useConversationExportPreview(client: Pick<DesktopRuntimeClient, 'getThread'>, ownerThreadId?: string) {
  const { t, locale } = useI18n();
  const requests = useIdentityRequestGuard(ownerThreadId ?? '');
  const nextPreviewId = useRef(0);
  const cancelPreparation = useRef<(() => void) | null>(null);
  const [state, setState] = useState<{ id: number; preview: ConversationExportPreview | null } | null>(null);
  const cancelPending = useCallback(() => {
    requests.invalidate();
    cancelPreparation.current?.();
    cancelPreparation.current = null;
  }, [requests]);
  // Message previews follow navigation; menu previews retain their explicitly chosen target.
  useLayoutEffect(() => {
    setState(null);
    return cancelPending;
  }, [cancelPending, ownerThreadId]);
  const close = useCallback(() => { cancelPending(); setState(null); }, [cancelPending]);
  const prepare = useCallback(async (threadId: string, format: DesktopConversationExportFormat, messageIds?: readonly string[]): Promise<PreparationResult> => {
    cancelPending();
    const isCurrent = requests.begin();
    // Keep the dialog mounted from preparation through preview; reset only for a new export.
    const id = ++nextPreviewId.current;
    setState({ id, preview: null });
    let cancel!: () => void;
    const cancelled = new Promise<PreparationResult>((resolve) => { cancel = () => resolve({ cancelled: true }); });
    cancelPreparation.current = cancel;
    const generate = async (): Promise<PreparationResult> => {
      try {
        const { prepareConversationExport } = await import('./exportConversation.js');
        if (!isCurrent()) return { cancelled: true };
        const preview = await prepareConversationExport(client, threadId, format, t, locale, messageIds);
        if (!isCurrent()) return { cancelled: true };
        setState({ id, preview });
        return {};
      } catch (error) {
        if (!isCurrent()) return { cancelled: true };
        setState(null);
        throw error;
      }
    };
    // Native rendering can finish in the background; closing must release the selection immediately.
    return Promise.race([generate(), cancelled]).finally(() => {
      if (cancelPreparation.current === cancel) cancelPreparation.current = null;
    });
  }, [cancelPending, client, locale, requests, t]);
  return { state, prepare, close };
}
