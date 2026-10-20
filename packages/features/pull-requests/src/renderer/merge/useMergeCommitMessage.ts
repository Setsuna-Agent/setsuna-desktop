import { useEffect, useState } from 'react';
import type { MergeMethod, PullRequestAction, PullRequestDetail, PullRequestMergeMessage } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';
import { errorText } from '../context.js';

/** Keep the account, revision and method fixed throughout preparation and editing. */
export type MergeConfirmation = {
  action: PullRequestAction['action'];
  detail: PullRequestDetail;
  account: string;
  method: MergeMethod;
};

export function useMergeCommitMessage(client: PullRequestsClient, confirmation: MergeConfirmation) {
  const { action, detail, account, method } = confirmation;
  const editable = (action === 'merge' || action === 'enable-auto-merge') && method !== 'REBASE' && !detail.queueRequired;
  const [message, setMessage] = useState<PullRequestMergeMessage | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!editable) return;
    const controller = new AbortController();
    setMessage(null);
    setError('');
    void client.mergeMessage({
      repository: detail.repository, number: detail.number, headSha: detail.headSha, baseBranch: detail.baseBranch,
      expectedAccount: account, method,
    }, controller.signal).then((value) => {
      if (!controller.signal.aborted) setMessage(value);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(errorText(cause));
    });
    return () => controller.abort();
  }, [account, attempt, client, detail, editable, method]);
  return { editable, message, setMessage, error, loading: editable && !message && !error, retry: () => setAttempt((value) => value + 1) };
}
