import {
  isRuntimeInputMessageAttachment,
  type RuntimeMessageAttachment,
  type RuntimeQueuedTurnInput,
} from '@setsuna-desktop/contracts';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  ChatQueuedTurnActions,
  ChatQueuedTurnEditSession,
} from '../hooks/useQueuedTurnInputActions.js';

export function useQueuedTurnComposerEdit({
  actions,
  attachmentsBusy,
  composerHasProtectedState,
  queuedTurnInputs,
  replaceComposer,
  resetComposer,
  sendableAttachments,
  setSubmitting,
  submitting,
}: {
  actions: ChatQueuedTurnActions;
  attachmentsBusy: boolean;
  composerHasProtectedState: boolean;
  queuedTurnInputs: RuntimeQueuedTurnInput[];
  replaceComposer: (input: RuntimeQueuedTurnInput) => void;
  resetComposer: () => void;
  sendableAttachments: RuntimeMessageAttachment[];
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  submitting: boolean;
}) {
  const [retrieving, setRetrieving] = useState(false);
  const [session, setSessionState] = useState<ChatQueuedTurnEditSession | null>(null);
  const mountedRef = useRef(true);
  const protectedStateRef = useRef(composerHasProtectedState);
  const sessionRef = useRef<ChatQueuedTurnEditSession | null>(null);
  const releaseRef = useRef(actions.releaseQueuedTurnInputEdit);
  protectedStateRef.current = composerHasProtectedState;
  releaseRef.current = actions.releaseQueuedTurnInputEdit;

  const setSession = useCallback((next: ChatQueuedTurnEditSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  const finish = useCallback(() => {
    setSession(null);
    resetComposer();
  }, [resetComposer, setSession]);

  const edit = useCallback(async (input: RuntimeQueuedTurnInput) => {
    if (protectedStateRef.current || attachmentsBusy || retrieving) return false;
    setRetrieving(true);
    const retrieved = await actions.retrieveQueuedTurnInput(input.id);
    if (mountedRef.current) setRetrieving(false);
    if (!retrieved) return false;
    if (!mountedRef.current) {
      await releaseRef.current(retrieved, { silent: true });
      return false;
    }
    if (protectedStateRef.current) {
      await actions.releaseQueuedTurnInputEdit(retrieved, { silent: true });
      return false;
    }

    // runtime 保留原队列项；composer 只接管可编辑副本，取消或失败仍能恢复原消息。
    setSession(retrieved);
    replaceComposer(retrieved.input);
    return true;
  }, [actions, attachmentsBusy, replaceComposer, retrieving, setSession]);

  const cancel = useCallback(async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    const released = await actions.releaseQueuedTurnInputEdit(session);
    if (!mountedRef.current) return;
    setSubmitting(false);
    if (released) finish();
  }, [actions, finish, session, setSubmitting, submitting]);

  const submit = useCallback(async (value: string) => {
    if (!session || attachmentsBusy || submitting) return;
    const input = value.trim();
    const attachments = sendableAttachments.filter(isRuntimeInputMessageAttachment);
    if (!input && !attachments.length) {
      await cancel();
      return;
    }

    setSubmitting(true);
    const result = await actions.updateQueuedTurnInput(session, input, attachments);
    if (!mountedRef.current) return;
    setSubmitting(false);
    if (result !== 'retained-after-error') finish();
  }, [
    actions,
    attachmentsBusy,
    cancel,
    finish,
    sendableAttachments,
    session,
    setSubmitting,
    submitting,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      if (activeSession) {
        void releaseRef.current(activeSession, { silent: true });
      }
    };
  }, []);

  useEffect(() => {
    if (session && !queuedTurnInputs.some((input) => input.id === session.input.id)) {
      // 其他窗口可能已发送或删除该项；清理接管的文本和附件，避免进入下一条普通消息。
      finish();
    }
  }, [finish, queuedTurnInputs, session]);

  const visibleQueuedTurnInputs = useMemo(
    () => queuedTurnInputs.filter((input) => input.id !== session?.input.id),
    [queuedTurnInputs, session?.input.id],
  );

  return {
    cancel,
    edit,
    editDisabled: composerHasProtectedState || attachmentsBusy,
    editing: Boolean(session),
    retrieving,
    submit,
    visibleQueuedTurnInputs,
  };
}
