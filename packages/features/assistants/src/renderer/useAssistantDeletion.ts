import { useEffect, useRef, useState } from 'react';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useConfirm } from '@setsuna-desktop/renderer-ui';
import type { AssistantsClient } from './client.js';
import { errorMessage } from './errors.js';

/** The editor and home entry share the same confirmation and deletion boundary. */
export function useAssistantDeletion({ client, translate: t, onDeleted, onError }: {
  client: Pick<AssistantsClient, 'delete'>;
  translate: RendererTranslate;
  onDeleted(): void | Promise<unknown>;
  onError(message: string | null): void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const confirm = useConfirm();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return {
    busy,
    async remove(assistantId: string) {
      if (pending.current || !mounted.current) return;
      pending.current = true;
      try {
        if (!await confirm({
          title: t('feature.assistants.deleteTitle'), description: t('feature.assistants.deleteDescription'),
          confirmLabel: t('feature.assistants.delete'), danger: true,
        }) || !mounted.current) return;
        setBusy(true); onError(null);
        await client.delete(assistantId);
        if (mounted.current) await onDeleted();
      } catch (cause) { if (mounted.current) onError(errorMessage(cause)); }
      finally { pending.current = false; if (mounted.current) setBusy(false); }
    },
  };
}
