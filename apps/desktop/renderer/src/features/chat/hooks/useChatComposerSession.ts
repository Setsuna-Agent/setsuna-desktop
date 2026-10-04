import type { RuntimeSkillReference } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { createChatAttachmentStore, type ChatAttachmentClient, type ChatAttachmentStore } from '../composer/chatAttachmentStore.js';

const globalNewThreadSlot = 'global';

export type ChatComposerTargetIdentity = `thread:${string}` | `new-thread-slot:${string}`;

export type ChatComposerSessionState = {
  draft: string;
  skillReferences: RuntimeSkillReference[];
  sessionId: number;
  targetIdentity: ChatComposerTargetIdentity;
};

export type SetChatComposerDraft = (value: SetStateAction<string>, skillReferences?: RuntimeSkillReference[]) => void;

export type ChatComposerSessionClaim = {
  fromIdentity: ChatComposerTargetIdentity;
  sessionId: number;
  toIdentity: ChatComposerTargetIdentity;
};

export function chatComposerTargetIdentity(
  threadId: string | null | undefined,
  projectId: string | null | undefined,
): ChatComposerTargetIdentity {
  return threadId
    ? `thread:${threadId}`
    : `new-thread-slot:${projectId || globalNewThreadSlot}`;
}

export function transitionChatComposerSession(
  current: ChatComposerSessionState,
  targetIdentity: ChatComposerTargetIdentity,
  claim: ChatComposerSessionClaim | null,
  nextSessionId: number,
  savedSession?: ChatComposerSessionState,
): { claimed: boolean; state: ChatComposerSessionState } {
  if (current.targetIdentity === targetIdentity) return { claimed: false, state: current };
  const claimed = Boolean(
    claim
    && claim.sessionId === current.sessionId
    && claim.fromIdentity === current.targetIdentity
    && claim.toIdentity === targetIdentity,
  );
  return {
    claimed,
    state: !claimed && savedSession ? savedSession : {
      draft: claimed ? current.draft : '',
      skillReferences: claimed ? current.skillReferences : [],
      sessionId: claimed ? current.sessionId : nextSessionId,
      targetIdentity,
    },
  };
}

type RetainedComposerSession = ChatComposerSessionState & { attachments: ChatAttachmentStore };
type ComposerSessions = {
  activeIdentity: ChatComposerTargetIdentity;
  entries: Map<ChatComposerTargetIdentity, RetainedComposerSession>;
};

/** Drafts and attachment ownership outlive editor mounts and ordinary navigation. */
export function useChatComposerSession(targetIdentity: ChatComposerTargetIdentity, client: ChatAttachmentClient) {
  const { t } = useI18n();
  const servicesRef = useRef({ client, t });
  servicesRef.current = { client, t };
  const nextSessionIdRef = useRef(2);
  const claimRef = useRef<ChatComposerSessionClaim | null>(null);
  const targetIdentityRef = useRef(targetIdentity);
  targetIdentityRef.current = targetIdentity;
  const [storedSessions, setStoredSessions] = useState<ComposerSessions>(() => ({
    activeIdentity: targetIdentity,
    entries: new Map([[targetIdentity, {
      draft: '', skillReferences: [], sessionId: 1, targetIdentity, attachments: createChatAttachmentStore(client, t),
    }]]),
  }));

  let sessions = storedSessions;
  if (sessions.activeIdentity !== targetIdentity) {
    const current = sessions.entries.get(sessions.activeIdentity)!;
    const saved = sessions.entries.get(targetIdentity);
    // Restore an occupied destination and retain the source separately, including pending uploads.
    const destinationOccupied = saved && (saved.draft || saved.skillReferences.length || saved.attachments.getSnapshot().items.length);
    const transition = transitionChatComposerSession(
      current, targetIdentity, destinationOccupied ? null : claimRef.current, nextSessionIdRef.current++, saved,
    );
    const next = {
      ...transition.state,
      attachments: transition.claimed ? current.attachments : saved?.attachments ?? createChatAttachmentStore(client, t),
    };
    const entries = new Map(sessions.entries);
    // First send/workspace selection transfers ownership, leaving no duplicate draft.
    if (transition.claimed) entries.delete(current.targetIdentity);
    entries.set(targetIdentity, next);
    sessions = { activeIdentity: targetIdentity, entries };
    // Retry before committing children so they never see the previous conversation's draft.
    setStoredSessions(sessions);
  }
  const session = sessions.entries.get(targetIdentity)!;
  const sessionId = session.sessionId;

  useEffect(() => {
    // React can replay the transition render (including in StrictMode). Consume
    // ownership only after commit, without erasing a new claim from this target.
    if (claimRef.current?.fromIdentity !== targetIdentity) claimRef.current = null;
  }, [targetIdentity]);

  const retainedStoresRef = useRef(new Set<ChatAttachmentStore>());
  useEffect(() => {
    const retained = new Set([...sessions.entries.values()].map((entry) => entry.attachments));
    for (const store of retainedStoresRef.current) {
      if (!retained.has(store)) store.dispose();
    }
    retainedStoresRef.current = retained;
  }, [sessions.entries]);
  useEffect(() => () => {
    for (const store of retainedStoresRef.current) store.dispose();
  }, []);

  const setDraft = useCallback<SetChatComposerDraft>((value, skillReferences) => {
    setStoredSessions((current) => {
      // Async sends keep writing to their originating draft even when it is hidden.
      // A reset rotates sessionId, so stale callbacks cannot resurrect discarded input.
      const entry = [...current.entries.values()].find((item) => item.sessionId === sessionId);
      if (!entry) return current;
      const nextDraft = typeof value === 'function' ? value(entry.draft) : value;
      if (typeof value === 'function' && nextDraft === entry.draft) return current;
      // Plain-text appends retain existing offsets; replacements must supply their own references.
      const nextReferences = skillReferences ?? (nextDraft.startsWith(entry.draft) ? entry.skillReferences : []);
      if (nextDraft === entry.draft && nextReferences.length === entry.skillReferences.length
        && nextReferences.every((reference, index) => {
          const previous = entry.skillReferences[index];
          return reference.skillId === previous.skillId && reference.start === previous.start && reference.end === previous.end;
        })) return current;
      const entries = new Map(current.entries);
      entries.set(entry.targetIdentity, { ...entry, draft: nextDraft, skillReferences: nextReferences });
      return { ...current, entries };
    });
  }, [sessionId]);

  const reset = useCallback(() => {
    claimRef.current = null;
    const identity = targetIdentityRef.current;
    const next: RetainedComposerSession = {
      draft: '', skillReferences: [], sessionId: nextSessionIdRef.current++, targetIdentity: identity,
      attachments: createChatAttachmentStore(servicesRef.current.client, servicesRef.current.t),
    };
    setStoredSessions((current) => ({
      ...current, entries: new Map(current.entries).set(identity, next),
    }));
  }, []);

  const claimForThread = useCallback((threadId: string) => {
    claimRef.current = {
      fromIdentity: targetIdentity,
      sessionId,
      toIdentity: chatComposerTargetIdentity(threadId, null),
    };
  }, [sessionId, targetIdentity]);

  const initializeThreadDraft = useCallback((threadId: string, draft: string) => {
    const identity = chatComposerTargetIdentity(threadId, null);
    const next: RetainedComposerSession = {
      draft, skillReferences: [], sessionId: nextSessionIdRef.current++, targetIdentity: identity,
      attachments: createChatAttachmentStore(servicesRef.current.client, servicesRef.current.t),
    };
    // Seed the destination before navigation; never write through the source editor's callback.
    setStoredSessions((current) => ({ ...current, entries: new Map(current.entries).set(identity, next) }));
  }, []);

  const claimForProject = useCallback((projectId: string | null) => {
    if (!targetIdentity.startsWith('new-thread-slot:')) return;
    // Choosing a workspace for the same unsent message must keep its draft and attachments.
    claimRef.current = {
      fromIdentity: targetIdentity,
      sessionId,
      toIdentity: chatComposerTargetIdentity(null, projectId),
    };
  }, [sessionId, targetIdentity]);

  return {
    attachmentStore: session.attachments,
    claimForProject,
    claimForThread,
    composerKey: `chat-composer-session:${sessionId}`,
    draft: session.draft,
    draftSkillReferences: session.skillReferences,
    initializeThreadDraft,
    reset,
    setDraft,
  };
}
