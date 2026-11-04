import type { RuntimeQueuedTurnInput } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatQueuedTurnActions } from '../hooks/useQueuedTurnInputActions.js';

export function useQueuedTurnComposerEdit({ actions, replaceComposer, submitting }: {
  actions: ChatQueuedTurnActions;
  replaceComposer: (input: RuntimeQueuedTurnInput) => void;
  submitting: boolean;
}) {
  const [retrieving, setRetrieving] = useState(false);
  const retrievingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const edit = useCallback(async (input: RuntimeQueuedTurnInput) => {
    if (submitting || retrievingRef.current) return false;
    retrievingRef.current = true;
    setRetrieving(true);
    try {
      const retrieved = await actions.retrieveQueuedTurnInput(input.id);
      if (!retrieved) return false;
      // This callback belongs to the original composer session; a late response
      // still restores that draft instead of dropping an already removed input.
      replaceComposer(retrieved);
      return true;
    } finally {
      retrievingRef.current = false;
      if (mountedRef.current) setRetrieving(false);
    }
  }, [actions, replaceComposer, submitting]);

  return { edit, retrieving };
}
