import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ChatTurnActions } from './useChatTurnActions.js';

type SendInput = ChatTurnActions['sendInput'];
type Submission = {
  input: string;
  options: Parameters<SendInput>[1];
  resolve: (accepted: boolean) => void;
  reject: (error: unknown) => void;
};

/** One submission boundary for the composer and other inputs targeting the same chat. */
export function useChatSubmissionQueue({ identity, draft, sendInput }: {
  identity: string;
  draft: string;
  sendInput: SendInput;
}): SendInput {
  const owner = useMemo(() => ({ identity, pending: [] as Submission[], sending: false }), [identity]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const mounted = useRef(true);
  const [, scheduleSubmission] = useReducer((revision: number) => revision + 1, 0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => () => {
    for (const pending of owner.pending.splice(0)) pending.resolve(false);
  }, [owner]);

  // Start after a commit so the previous send's thread/turn updates reach sendInput.
  // Uploads remain independent; only submission (including beforeSend) holds this queue.
  useEffect(() => {
    if (owner.sending || !mounted.current || currentOwner.current !== owner) return;
    const next = owner.pending.shift();
    if (!next) return;
    owner.sending = true;
    const submit = async () => {
      try {
        next.resolve(await sendInput(next.input, next.options));
      } catch (error) {
        next.reject(error);
      } finally {
        owner.sending = false;
        if (mounted.current && currentOwner.current === owner) scheduleSubmission();
      }
    };
    void submit();
  });

  return useCallback((value, options) => {
    if (!mounted.current || currentOwner.current !== owner) return Promise.resolve(false);
    return new Promise<boolean>((resolve, reject) => {
      // Capture the submitted text now, before the user can edit a waiting draft.
      owner.pending.push({ input: value ?? draft, options, resolve, reject });
      scheduleSubmission();
    });
  }, [draft, owner]);
}
