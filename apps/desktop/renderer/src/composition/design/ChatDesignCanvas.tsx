import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { DesignDocumentSurface, type DesignCanvasSelection } from '@setsuna-desktop/feature-design/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { isFeatureOperationCancelled } from '@setsuna-desktop/feature-core/operation';
import type { DesignConversationOwner, DesignDocumentRef } from '@setsuna-desktop/feature-design/contracts';
import { conversationArtifacts, designEntryKey } from '../../features/chat/artifacts/conversationArtifacts.js';
import { ChatDesignNavigation } from '../../features/chat/mentions/ChatDesignReference.js';
import { DesignSelectionProvider } from '../../features/chat/mentions/DesignSelectionReference.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { FeatureRecoveryShell } from '../FeatureRecoveryShell.js';
import { useDesignClient } from './DesignClientContext.js';
import { watchDesignDirectories } from './design-assets.js';
import { createChatCanvasSelections } from './chatCanvasSelections.js';

const Activity = createContext<{ entries: ReturnType<typeof conversationArtifacts>; turnId: string | null; threadId?: string }>({ entries: new Map(), turnId: null });
const Selections = createContext<ReturnType<typeof createChatCanvasSelections> | null>(null);

export function MainChatDesignSelection({ children }: { children: ReactNode }) {
  return <DesignSelectionProvider value={useContext(Selections)?.composer ?? null}>{children}</DesignSelectionProvider>;
}

export function useLiveChatCanvasKey() {
  const { entries, turnId } = useContext(Activity);
  return useMemo(() => {
    let latest: string | undefined;
    if (turnId) for (const [key, entry] of entries) {
      if (entry.kind === 'design' && entry.turnId === turnId && entry.design.canvasRequestId) latest = key;
    }
    return latest;
  }, [entries, turnId]);
}

export function ChatDesignPanels({ thread, activeTurnId, open, children }: {
  thread: RuntimeThread | null; activeTurnId: string | null; open(owner: DesignConversationOwner): void; children: ReactNode;
}) {
  const entries = useMemo(() => conversationArtifacts(thread?.messages ?? []), [thread?.messages]);
  const observed = useRef<{ threadId: string; requests: Set<string>; seq: number }>();
  const threadId = thread?.id;
  // A pending gesture or reveal belongs to this conversation, even if its tab is reused.
  const selections = useMemo(() => createChatCanvasSelections(open), [open, threadId]);
  const activity = useMemo(() => ({ entries, turnId: activeTurnId, threadId }), [entries, activeTurnId, threadId]);
  const seq = thread?.lastSeq ?? 0;
  const latestTurnId = thread?.turns?.at(-1)?.id;
  useEffect(() => {
    if (!threadId) { observed.current = undefined; return; }
    const previous = observed.current?.threadId === threadId ? observed.current : undefined;
    const requests = new Set<string>();
    let latest: DesignConversationOwner | undefined;
    for (const entry of entries.values()) {
      if (entry.kind !== 'design') continue;
      requests.add(entry.openRequest);
      // A single SSE batch may already include the end of a fast turn. A restored, idle
      // conversation only restores its tabs, even if the history contains the same receipt.
      if (!previous?.requests.has(entry.openRequest) && entry.turnId && (entry.turnId === activeTurnId
        || (previous && seq > previous.seq && entry.turnId === latestTurnId))) latest = entry.design;
    }
    observed.current = { threadId, requests, seq };
    if (latest) open(latest);
  }, [activeTurnId, entries, latestTurnId, open, seq, threadId]);
  return <ChatDesignNavigation value={open}><Activity.Provider value={activity}>
    <Selections.Provider value={selections}>{children}</Selections.Provider>
  </Activity.Provider></ChatDesignNavigation>;
}

export function ChatDesignCanvas({ owner, visible = true }: { owner: DesignConversationOwner; visible?: boolean }) {
  const client = useDesignClient();
  const { t } = useI18n();
  const toast = useToast();
  const { entries, turnId, threadId } = useContext(Activity);
  const selections = useContext(Selections);
  const connectSelection = useMemo(() => selections && ((canvas: DesignCanvasSelection) => selections.connect(owner, canvas)), [selections, owner]);
  const key = designEntryKey(owner);
  const entry = entries.get(key);
  const design = entry?.kind === 'design' ? entry.design : undefined;
  const [source, setSource] = useState<{ key: string; ref: DesignDocumentRef }>();
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    // A legacy draft may belong to overlapping roots. Load its assets relative to the same
    // directory as the full editor, while retaining the chat reference for activity updates.
    void client.resolveResourceRoot(owner.ref, controller.signal).then((ref) => {
      if (!controller.signal.aborted) setSource({ key, ref });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !isFeatureOperationCancelled(error)) {
        toast.error(t('feature.design.loadFailed', { error: error instanceof Error ? error.message : String(error) }));
      }
    });
    return () => controller.abort();
  }, [client, key, owner.ref, t, toast]);
  if (!client) return <FeatureRecoveryShell candidateFeatureIds={['design']} reason="view-missing" />;
  if (source?.key !== key) return null;
  return <DesignDocumentSurface client={client} documentRef={source.ref} expectedDocumentId={owner.documentId}
    watchDirectories={watchDesignDirectories} fileRevision={design?.revision} chatActivity={{ connectSelection: visible ? connectSelection ?? undefined : undefined, networkAccess: design?.networkAccess === true,
      request: threadId && turnId && entry?.kind === 'design' && entry.turnId === turnId && design?.canvasRequestId
        ? { threadId, id: design.canvasRequestId } : undefined }} translate={t} />;
}
