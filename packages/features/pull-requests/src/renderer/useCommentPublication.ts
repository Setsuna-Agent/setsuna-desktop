import { useCallback, useEffect, useRef } from 'react';
import type { PullRequestReference } from '../contracts/index.js';
import { isAccountChangedError, type PullRequestsClient } from './client.js';
import { errorText, usePrText, usePullRequestsHost } from './context.js';
import { readDraft, readDraftState, saveDraft, setDraftPublishing, settleDraft, type CommentDraft } from './useCommentDraft.js';

const errorCode = (cause: unknown) => cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
const unsentCodes = new Set(['PR_COMMENT_NOT_SENT', 'PR_ACCOUNT_CHANGED', 'GITHUB_ACCESS_DENIED', 'GITHUB_RATE_LIMITED', 'PR_NOT_FOUND', 'PR_ACTION_BLOCKED', 'INVALID_INPUT']);

/** Owns send/recovery independently of the mounted editor, including shared reply drafts. */
export function useCommentPublication({ client, reference: { repository, number }, account, threadId, draftKey, disabled, onPublished }: {
  client: PullRequestsClient; reference: PullRequestReference; account: string; threadId: string | null;
  draftKey: string; disabled?: boolean; onPublished(): void;
}) {
  const t = usePrText();
  const { notifyError } = usePullRequestsHost();
  const current = useRef({ draftKey, onPublished });
  current.current = { draftKey, onPublished };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback(async (recoveryOnly: boolean) => {
    let { draft, pending } = readDraftState(draftKey);
    if (pending || (recoveryOnly ? !draft.uncertain : disabled || (!draft.body.trim() && !draft.uncertain))) return;
    const published = (sent: CommentDraft) => {
      settleDraft(draftKey, sent.requestId, true);
      if (alive.current && current.current.draftKey === draftKey) current.current.onPublished();
    };
    const check = async (sent: CommentDraft) => {
      try {
        await client.publish({ repository, number, expectedAccount: account, threadId, body: sent.submittedBody ?? sent.body, requestId: sent.requestId, reconcileOnly: true });
        published(sent);
        return true;
      } catch (cause) {
        if (errorCode(cause) !== 'PR_COMMENT_NOT_FOUND') throw cause;
        settleDraft(draftKey, sent.requestId, false);
        return false;
      }
    };
    const failureMessage = (cause: unknown) => isAccountChangedError(cause) ? t('accountChanged') : /OAuth App access restrictions/iu.test(errorText(cause))
      ? t('organizationApprovalRequired', { organization: repository.split('/')[0] })
      : t('commentFailed', { error: errorText(cause) });

    setDraftPublishing(draftKey, true);
    try {
      if (draft.uncertain) {
        const found = await check(draft);
        if (recoveryOnly) {
          if (!found) notifyError(t('publicationNotFound'));
          return;
        }
        if (found && draft.body === (draft.submittedBody ?? draft.body)) return;
        if (readDraft(draftKey).body !== draft.body) return;
        draft = readDraft(draftKey);
      }
      if (!draft.body.trim()) return;
      const sent = { ...draft, uncertain: true, submittedBody: draft.body };
      saveDraft(draftKey, sent);
      try {
        // Persist before dispatch so a renderer reload can recover a lost response.
        await client.publish({ repository, number, expectedAccount: account, threadId, body: sent.body, requestId: sent.requestId, reconcileOnly: false });
        published(sent);
      } catch (cause) {
        if (unsentCodes.has(errorCode(cause))) {
          settleDraft(draftKey, sent.requestId, false);
          notifyError(failureMessage(cause));
          return;
        }
        // A failed response is not a failed write. Look up all pages before showing
        // a failure, and never automatically dispatch a second mutation.
        try {
          if (!await check(sent)) notifyError(failureMessage(cause));
        } catch (checkError) {
          notifyError(t('publicationRecoveryFailed', { error: errorText(cause), checkError: errorText(checkError) }));
        }
      }
    } catch (cause) {
      notifyError(isAccountChangedError(cause) ? t('accountChanged') : t('publicationCheckFailed', { error: errorText(cause) }));
    } finally { setDraftPublishing(draftKey, false); }
  }, [client, repository, number, account, threadId, draftKey, disabled, notifyError, t]);

  // Recover persisted attempts on entry, once per mounted target. Shared pending
  // state prevents Overview and Diff from starting the same recovery concurrently.
  const recoveredKey = useRef<string>();
  useEffect(() => {
    if (recoveredKey.current === draftKey) return;
    recoveredKey.current = draftKey;
    void run(true);
  }, [draftKey, run]);
  return () => run(false);
}
