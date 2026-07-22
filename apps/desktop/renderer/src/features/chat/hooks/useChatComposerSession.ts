import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

const globalNewThreadSlot = 'global';

export type ChatComposerTargetIdentity = `thread:${string}` | `new-thread-slot:${string}`;

export type ChatComposerSessionState = {
  draft: string;
  sessionId: number;
  targetIdentity: ChatComposerTargetIdentity;
};

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
    state: {
      draft: claimed ? current.draft : '',
      sessionId: claimed ? current.sessionId : nextSessionId,
      targetIdentity,
    },
  };
}

/**
 * Owns the state that must travel together with a composer. Normal navigation
 * starts a fresh session; creating the first runtime thread explicitly claims the
 * current new-thread slot so the in-flight composer is not torn down mid-send.
 */
export function useChatComposerSession(targetIdentity: ChatComposerTargetIdentity) {
  const nextSessionIdRef = useRef(2);
  const claimRef = useRef<ChatComposerSessionClaim | null>(null);
  const targetIdentityRef = useRef(targetIdentity);
  targetIdentityRef.current = targetIdentity;
  const [storedSession, setStoredSession] = useState<ChatComposerSessionState>(() => ({
    draft: '',
    sessionId: 1,
    targetIdentity,
  }));

  let session = storedSession;
  if (storedSession.targetIdentity !== targetIdentity) {
    const transition = transitionChatComposerSession(
      storedSession,
      targetIdentity,
      claimRef.current,
      nextSessionIdRef.current++,
    );
    session = transition.state;
    claimRef.current = null;
    // React immediately retries this component before committing children, so a
    // different conversation never receives one frame of the previous draft.
    setStoredSession(session);
  }

  const sessionId = session.sessionId;
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    setStoredSession((current) => {
      if (current.sessionId !== sessionId) return current;
      const nextDraft = typeof value === 'function' ? value(current.draft) : value;
      return nextDraft === current.draft ? current : { ...current, draft: nextDraft };
    });
  }, [sessionId]);

  const reset = useCallback(() => {
    claimRef.current = null;
    setStoredSession({
      draft: '',
      sessionId: nextSessionIdRef.current++,
      targetIdentity: targetIdentityRef.current,
    });
  }, []);

  const claimForThread = useCallback((threadId: string) => {
    claimRef.current = {
      fromIdentity: targetIdentity,
      sessionId,
      toIdentity: chatComposerTargetIdentity(threadId, null),
    };
  }, [sessionId, targetIdentity]);

  return {
    claimForThread,
    composerKey: `chat-composer-session:${sessionId}`,
    draft: session.draft,
    reset,
    setDraft,
  };
}
