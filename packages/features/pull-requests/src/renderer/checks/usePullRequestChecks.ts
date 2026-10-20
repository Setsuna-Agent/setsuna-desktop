import { useCallback, useEffect, useState } from 'react';
import type { PullRequestCheck, PullRequestDetail } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';
import { errorText } from '../context.js';
import { useSessionData, type PullRequestDetailData } from '../reading/session-data.js';

const empty: PullRequestCheck[] = [];

export function usePullRequestChecks(client: PullRequestsClient, detail: PullRequestDetail, revision: number, data: PullRequestDetailData) {
  const { repository, number, checksCommit } = detail;
  const key = JSON.stringify([repository, number, checksCommit]);
  const [items, setItems, loaded] = useSessionData(data.checks, key, empty);
  const [status, setStatus] = useState({ key, pending: true, error: '' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const request = new AbortController();
    setStatus({ key, pending: true, error: '' });
    void (async () => {
      try {
        const checks: PullRequestCheck[] = [];
        if (checksCommit) {
          let cursor: string | null = null;
          do {
            const page = await client.checks({ repository, number, commitSha: checksCommit, cursor }, request.signal);
            if (request.signal.aborted) return;
            checks.push(...page.items);
            cursor = page.cursor;
          } while (cursor);
        }
        // Publish all pages together so refreshes cannot unmount later checks or lose their expansion.
        if (!request.signal.aborted) {
          setItems(checks);
          setStatus({ key, pending: false, error: '' });
        }
      } catch (cause) {
        if (!request.signal.aborted) setStatus({ key, pending: false, error: errorText(cause) });
      }
    })();
    return () => request.abort();
  }, [client, repository, number, checksCommit, key, revision, attempt, setItems]);

  // A different commit must never display the previous commit's checks, even before effects run.
  return { items, loaded, ...(status.key === key ? status : { pending: true, error: '' }), retry };
}
