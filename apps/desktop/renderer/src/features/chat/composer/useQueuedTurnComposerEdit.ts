import type { RuntimeQueuedTurnInput } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatQueuedTurnActions } from '../hooks/useQueuedTurnInputActions.js';

export function useQueuedTurnComposerEdit({ actions, replaceComposer, retrievingControl, submitting }: {
  actions: ChatQueuedTurnActions;
  replaceComposer: (input: RuntimeQueuedTurnInput) => void;
  retrievingControl?: { value: boolean; onChange: (retrieving: boolean) => void };
  submitting: boolean;
}) {
  const [localRetrieving, setLocalRetrieving] = useState(false);
  const retrieving = retrievingControl?.value ?? localRetrieving;
  const setRetrieving = retrievingControl?.onChange ?? setLocalRetrieving;
  const controlled = Boolean(retrievingControl);
  const retrievingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const edit = useCallback(async (input: RuntimeQueuedTurnInput) => {
    if (submitting || retrieving || retrievingRef.current) return false;
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
      // Retained sessions must release their lock even when this editor unmounted.
      if (controlled || mountedRef.current) setRetrieving(false);
    }
  }, [actions, controlled, replaceComposer, retrieving, setRetrieving, submitting]);

  return { edit, retrieving };
}
