import { useCallback, useEffect, useState } from 'react';
import type { PullRequestCheck, PullRequestDetail } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';
import { errorText } from '../context.js';

type Snapshot = { key: string; items: PullRequestCheck[]; pending: boolean; error: string };

export function usePullRequestChecks(client: PullRequestsClient, detail: PullRequestDetail, revision: number) {
  const { repository, number, checksCommit } = detail;
  const key = JSON.stringify([repository, number, checksCommit]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ key, items: [], pending: true, error: '' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const request = new AbortController();
    setSnapshot((current) => ({ key, items: current.key === key ? current.items : [], pending: true, error: '' }));
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
        if (!request.signal.aborted) setSnapshot({ key, items: checks, pending: false, error: '' });
      } catch (cause) {
        if (!request.signal.aborted) setSnapshot((current) => ({ ...current, pending: false, error: errorText(cause) }));
      }
    })();
    return () => request.abort();
  }, [client, repository, number, checksCommit, key, revision, attempt]);

  // A different commit must never display the previous commit's checks, even before effects run.
  return { ...(snapshot.key === key ? snapshot : { items: [], pending: true, error: '' }), retry };
}
