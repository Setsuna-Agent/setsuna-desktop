import type { RuntimeSkillReference } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { createChatAttachmentStore, type ChatAttachmentClient, type ChatAttachmentStore } from '../composer/chatAttachmentStore.js';
import { chatComposerTargetIdentity, chatComposerNewThreadTarget, type ChatComposerTargetIdentity } from '../session/chatComposerIdentity.js';
import { readChatDraft } from '../session/chatDraftRecovery.js';
import type { WorkspaceDraftReference } from '../session/chatDraftReferences.js';
import { useSessionWriter } from '../../../shared/preferences/sessionStorage.js';

export { chatComposerTargetIdentity, chatComposerNewThreadTarget, type ChatComposerTargetIdentity } from '../session/chatComposerIdentity.js';

export type ChatComposerSessionState = {
  draft: string;
  skillReferences: RuntimeSkillReference[];
  workspaceReferences: WorkspaceDraftReference[];
  sessionId: number;
  targetIdentity: ChatComposerTargetIdentity;
};

type ComposerDraftSource = 'draft' | 'queued-edit';

export type SetChatComposerDraft = (
  value: SetStateAction<string>,
  skillReferences?: RuntimeSkillReference[],
  workspaceReferences?: WorkspaceDraftReference[],
  options?: { source?: ComposerDraftSource },
) => void;

export type ChatComposerSessionClaim = {
  fromIdentity: ChatComposerTargetIdentity;
  sessionId: number;
  toIdentity: ChatComposerTargetIdentity;
};

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
      workspaceReferences: claimed ? current.workspaceReferences : [],
      sessionId: claimed ? current.sessionId : nextSessionId,
      targetIdentity,
    },
  };
}

type RetainedComposerSession = ChatComposerSessionState & {
  attachments: ChatAttachmentStore;
  draftSource: ComposerDraftSource;
};
type ComposerSessions = {
  windowKey: string | null;
  activeIdentity: ChatComposerTargetIdentity;
  entries: Map<ChatComposerTargetIdentity, RetainedComposerSession>;
};

/** Drafts and attachment ownership outlive editor mounts and ordinary navigation. */
export function useChatComposerSession(targetIdentity: ChatComposerTargetIdentity, client: ChatAttachmentClient, windowKey: string | null = null) {
  const { t } = useI18n();
  const servicesRef = useRef({ client, t });
  servicesRef.current = { client, t };
  const nextSessionIdRef = useRef(2);
  const claimRef = useRef<ChatComposerSessionClaim | null>(null);
  const targetIdentityRef = useRef(targetIdentity);
  targetIdentityRef.current = targetIdentity;
  const writer = useSessionWriter(windowKey, 'draft');
  const restoreSession = (identity: ChatComposerTargetIdentity, sessionId: number): RetainedComposerSession => ({
    ...readChatDraft(windowKey, identity), sessionId, targetIdentity: identity,
    draftSource: 'draft', attachments: createChatAttachmentStore(client, t),
  });
  const [storedSessions, setStoredSessions] = useState<ComposerSessions>(() => ({
    windowKey,
    activeIdentity: targetIdentity,
    entries: new Map([[targetIdentity, restoreSession(targetIdentity, 1)]]),
  }));

  let sessions = storedSessions;
  if (sessions.windowKey !== windowKey) {
    sessions = { windowKey, activeIdentity: targetIdentity, entries: new Map([[targetIdentity, restoreSession(targetIdentity, nextSessionIdRef.current++)]]) };
    setStoredSessions(sessions);
  }
  if (sessions.activeIdentity !== targetIdentity) {
    const current = sessions.entries.get(sessions.activeIdentity)!;
    const saved = sessions.entries.get(targetIdentity) ?? restoreSession(targetIdentity, nextSessionIdRef.current++);
    // Restore an occupied destination and retain the source separately, including pending uploads.
    const destinationOccupied = saved && (saved.draft || saved.skillReferences.length || saved.attachments.getSnapshot().items.length);
    const transition = transitionChatComposerSession(
      current, targetIdentity, destinationOccupied ? null : claimRef.current, nextSessionIdRef.current++, saved,
    );
    const next = {
      ...transition.state,
      draftSource: transition.claimed ? current.draftSource : saved.draftSource,
      attachments: transition.claimed ? current.attachments : saved?.attachments ?? createChatAttachmentStore(client, t),
    };
    const entries = new Map(sessions.entries);
    // First send/workspace selection transfers ownership, leaving no duplicate draft.
    if (transition.claimed) entries.delete(current.targetIdentity);
    entries.set(targetIdentity, next);
    sessions = { windowKey, activeIdentity: targetIdentity, entries };
    // Retry before committing children so they never see the previous conversation's draft.
    setStoredSessions(sessions);
  }
  const session = sessions.entries.get(targetIdentity)!;
  const sessionId = session.sessionId;

  const persistedSessionsRef = useRef(sessions);
  useEffect(() => {
    const previous = persistedSessionsRef.current;
    persistedSessionsRef.current = sessions;
    if (previous.windowKey !== windowKey) return;
    for (const [identity, entry] of sessions.entries) {
      const old = previous.entries.get(identity);
      // Queue edits are borrowed copies backed by runtime events. Never restore
      // one as a normal draft without its edit token, including after a crash.
      if (entry.draftSource === 'queued-edit') {
        if (old?.draftSource !== 'queued-edit') writer.write(identity, null);
        continue;
      }
      if (old?.draftSource === entry.draftSource && old?.draft === entry.draft
        && old?.skillReferences === entry.skillReferences && old?.workspaceReferences === entry.workspaceReferences) continue;
      writer.write(identity, entry.draft ? { draft: entry.draft, skillReferences: entry.skillReferences, workspaceReferences: entry.workspaceReferences } : null);
    }
    for (const identity of previous.entries.keys()) if (!sessions.entries.has(identity)) writer.write(identity, null);
  }, [sessions, windowKey, writer]);

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

  const setDraft = useCallback<SetChatComposerDraft>((value, skillReferences, workspaceReferences, options) => {
    setStoredSessions((current) => {
      // Async sends keep writing to their originating draft even when it is hidden.
      // A reset rotates sessionId, so stale callbacks cannot resurrect discarded input.
      const entry = [...current.entries.values()].find((item) => item.sessionId === sessionId);
      if (!entry) return current;
      const nextDraft = typeof value === 'function' ? value(entry.draft) : value;
      // Ordinary typing inherits the edit's source until its owner explicitly finishes.
      const draftSource = options?.source ?? entry.draftSource;
      if (typeof value === 'function' && nextDraft === entry.draft && draftSource === entry.draftSource) return current;
      // Plain-text appends retain existing offsets; replacements must supply their own references.
      const nextReferences = skillReferences ?? (nextDraft.startsWith(entry.draft) ? entry.skillReferences : []);
      const nextWorkspaceReferences = workspaceReferences ?? (nextDraft.startsWith(entry.draft) ? entry.workspaceReferences : []);
      if (draftSource === entry.draftSource && nextDraft === entry.draft && nextReferences.length === entry.skillReferences.length
        && nextReferences.every((reference, index) => {
          const previous = entry.skillReferences[index];
          return reference.skillId === previous.skillId && reference.start === previous.start && reference.end === previous.end;
        }) && nextWorkspaceReferences.length === entry.workspaceReferences.length
        && nextWorkspaceReferences.every((reference, index) => {
          const previous = entry.workspaceReferences[index];
          return reference.start === previous.start && reference.end === previous.end && reference.entry === previous.entry;
        })) return current;
      const entries = new Map(current.entries);
      entries.set(entry.targetIdentity, { ...entry, draft: nextDraft, draftSource, skillReferences: nextReferences, workspaceReferences: nextWorkspaceReferences });
      return { ...current, entries };
    });
  }, [sessionId]);

  const reset = useCallback(() => {
    claimRef.current = null;
    const identity = targetIdentityRef.current;
    const next: RetainedComposerSession = {
      draft: '', skillReferences: [], workspaceReferences: [], sessionId: nextSessionIdRef.current++, targetIdentity: identity,
      draftSource: 'draft',
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

  const initializeNewThreadDraft = useCallback((projectId: string | null, draft: string) => {
    const sessionId = nextSessionIdRef.current++;
    const draftId = crypto.randomUUID();
    const identity = chatComposerTargetIdentity(null, projectId, draftId);
    claimRef.current = null;
    const next: RetainedComposerSession = {
      draft, skillReferences: [], workspaceReferences: [], sessionId, targetIdentity: identity,
      draftSource: 'draft',
      attachments: createChatAttachmentStore(servicesRef.current.client, servicesRef.current.t),
    };
    // Prefills get a local identity so neither visible nor hidden unsent input is replaced.
    setStoredSessions((current) => ({ ...current, entries: new Map(current.entries).set(identity, next) }));
    return draftId;
  }, []);

  const claimForProject = useCallback((projectId: string | null) => {
    const target = chatComposerNewThreadTarget(targetIdentity);
    if (!target) return;
    // Choosing a workspace for the same unsent message must keep its draft and attachments.
    claimRef.current = {
      fromIdentity: targetIdentity,
      sessionId,
      toIdentity: chatComposerTargetIdentity(null, projectId, target.draftId),
    };
  }, [sessionId, targetIdentity]);

  const discardThread = useCallback((threadId: string) => {
    const identity = chatComposerTargetIdentity(threadId, null);
    writer.write(identity, null);
    setStoredSessions((current) => {
      const entry = current.entries.get(identity);
      if (!entry) return current;
      const entries = new Map(current.entries);
      entries.set(identity, {
        ...entry, draft: '', skillReferences: [], workspaceReferences: [], sessionId: nextSessionIdRef.current++,
        draftSource: 'draft',
        attachments: createChatAttachmentStore(servicesRef.current.client, servicesRef.current.t),
      });
      return { ...current, entries };
    });
  }, [writer]);

  return {
    attachmentStore: session.attachments,
    claimForProject,
    claimForThread,
    composerKey: `chat-composer-session:${sessionId}`,
    draft: session.draft,
    draftSkillReferences: session.skillReferences,
    draftWorkspaceReferences: session.workspaceReferences,
    discardThread,
    initializeNewThreadDraft,
    reset,
    setDraft,
  };
}
