import type { DesktopRuntimeClient, RuntimeMessage } from '@setsuna-desktop/contracts';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { conversationArtifacts } from './conversationArtifacts.js';

export function useConversationArtifacts(client: Pick<DesktopRuntimeClient, 'listThreadMessages'>, threadId: string,
  messages: readonly RuntimeMessage[], before: number | null) {
  // The group is keyed by thread and history mutation. Only backfill what preceded its initial
  // message window, then overlay the live results without retaining historical message bodies.
  const [initialCursor] = useState(before);
  const [history, setHistory] = useState<ReturnType<typeof conversationArtifacts>>();
  const toast = useToast();
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (initialCursor === null) return;
      let cursor: number | null = initialCursor;
      const entries: ReturnType<typeof conversationArtifacts> = new Map();
      while (cursor !== null) {
        const page = await client.listThreadMessages(threadId, { before: cursor, limit: 200 });
        if (cancelled) return;
        for (const [key, value] of conversationArtifacts(page.messages)) if (!entries.has(key)) entries.set(key, value);
        cursor = page.nextBefore !== null && page.nextBefore < cursor ? page.nextBefore : null;
      }
      setHistory(entries);
    }
    void load().catch((error: unknown) => { if (!cancelled) toast.error(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [client, initialCursor, threadId, toast]);
  return useMemo(() => Array.from(new Map([...(history ?? []), ...conversationArtifacts(messages)])), [history, messages]);
}
