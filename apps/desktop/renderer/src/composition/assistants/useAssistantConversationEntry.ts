import type { AssistantsRendererService } from '@setsuna-desktop/feature-assistants/renderer';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const subscribeEmpty = () => () => undefined;
const emptySnapshot = () => null;

/** Pointer and keyboard entry share navigation ownership and a synchronous pending guard. */
export function useAssistantConversationEntry({ service, onOpenConversation, onError }: {
  service: AssistantsRendererService | null;
  onOpenConversation(destination: () => Promise<string>): Promise<boolean>;
  onError(message: string): void;
}) {
  const snapshot = useSyncExternalStore(service?.store.subscribe ?? subscribeEmpty, service?.store.getSnapshot ?? emptySnapshot);
  const [opening, setOpening] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    // Load in the background so navigation shortcuts also work outside the home sidebar.
    void service?.store.refresh(abort.signal).catch(() => undefined);
    return () => { mounted.current = false; abort.abort(); };
  }, [service]);

  const open = useCallback(async (assistantId?: string) => {
    const targetId = assistantId ?? service?.store.getSnapshot()?.assistants[0]?.id;
    if (!service || !targetId || pending.current || !mounted.current) return;
    pending.current = true;
    setOpening(true);
    try {
      await onOpenConversation(async () => {
        const { threadId } = await service.client.openConversation(targetId);
        await service.store.refresh();
        return threadId;
      });
    } catch (cause) {
      if (mounted.current) onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setOpening(false);
    }
  }, [onError, onOpenConversation, service]);

  return { available: Boolean(snapshot?.assistants.length), opening, open };
}

export type AssistantConversationEntry = ReturnType<typeof useAssistantConversationEntry>;
