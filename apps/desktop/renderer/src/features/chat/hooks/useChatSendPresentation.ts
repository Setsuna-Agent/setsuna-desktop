import {
  isRuntimeInputMessageAttachment,
  type RuntimeMessage,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatComposerSendOptions } from '../composer/chatComposerSendOptions.js';
import { createChatTurnClientId } from './chatTurnSubmission.js';
import { shouldQueueComposerTurn } from './useChatTurnActions.js';

type Submission = {
  clientId: string;
  composerKey: string;
  message?: RuntimeMessage;
  submitting: boolean;
};

/** Pending bubbles are presentation only; runtime messages remain the persisted source of truth. */
export function useChatSendPresentation({ activeTurnId, composerKey, currentThread, draft, messages, onSend }: {
  activeTurnId: string | null;
  composerKey: string;
  currentThread: RuntimeThread | null;
  draft: string;
  messages: RuntimeMessage[];
  onSend: (value?: string, options?: ChatComposerSendOptions) => Promise<boolean>;
}) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const confirmedClientIds = useMemo(() => new Set([
    ...messages.map((message) => message.clientId),
    ...(currentThread?.queuedTurnInputs ?? []).map((input) => input.clientId),
  ].filter((id): id is string => Boolean(id))), [currentThread?.queuedTurnInputs, messages]);
  const pendingMessages = useMemo(() => submissions.flatMap((submission) => (
    submission.composerKey === composerKey && submission.message && !confirmedClientIds.has(submission.clientId)
      ? [submission.message] : []
  )), [composerKey, confirmedClientIds, submissions]);
  const submitting = submissions.some((submission) => submission.composerKey === composerKey && submission.submitting);

  useEffect(() => {
    setSubmissions((current) => {
      const next = current.flatMap((submission) => {
        if (submission.composerKey !== composerKey || !confirmedClientIds.has(submission.clientId)) return [submission];
        if (!submission.submitting) return [];
        // Keep the send lock after an early echo, but never resurrect that bubble if history changes.
        return submission.message ? [{ ...submission, message: undefined }] : [submission];
      });
      return next.length === current.length && next.every((submission, index) => submission === current[index]) ? current : next;
    });
  }, [composerKey, confirmedClientIds, submissions]);

  const sendInput = useCallback(async (value?: string, options: ChatComposerSendOptions = {}) => {
    const input = (value ?? draft).trim();
    const attachments = (options.attachments ?? []).filter(isRuntimeInputMessageAttachment);
    if (!input && !attachments.length) return false;
    const clientId = options.clientId ?? createChatTurnClientId();
    const message: RuntimeMessage | undefined = shouldQueueComposerTurn(activeTurnId, options) ? undefined : {
      id: `pending_${clientId}`, clientId, role: 'user', status: 'complete',
      createdAt: new Date().toISOString(), content: input, attachments, skillReferences: options.skillReferences,
    };
    // Insert before any workspace checks or thread creation can yield to the runtime bridge.
    setSubmissions((current) => [...current, { clientId, composerKey, message, submitting: true }]);
    let sent = false;
    try {
      sent = await onSend(value, { ...options, clientId });
      return sent;
    } finally {
      setSubmissions((current) => current.flatMap((submission) => {
        if (submission.composerKey !== composerKey || submission.clientId !== clientId) return [submission];
        return sent && submission.message ? [{ ...submission, submitting: false }] : [];
      }));
    }
  }, [activeTurnId, composerKey, draft, onSend]);

  return { pendingMessages, sendInput, submitting };
}
