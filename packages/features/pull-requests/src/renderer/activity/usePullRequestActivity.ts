import { useCallback, useEffect, useRef, useState } from 'react';
import type { PullRequestActivityEvent, PullRequestReference } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';
import { errorText } from '../context.js';

type Snapshot = { items: PullRequestActivityEvent[]; cursor: string | null; depth: number };
const empty: Snapshot = { items: [], cursor: null, depth: 0 };

export function usePullRequestActivity(client: PullRequestsClient, { repository, number }: PullRequestReference, revision: number) {
  const [snapshot, setSnapshot] = useState(empty);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const current = useRef(snapshot);
  current.current = snapshot;
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    busy.current = true;
    setPending(true);
    setError('');
    void (async () => {
      try {
        const items = new Map<string, PullRequestActivityEvent>();
        let cursor: string | null = null;
        let depth = 0;
        do {
          const page = await client.activity({ repository, number, cursor }, request.signal);
          if (request.signal.aborted) return;
          for (const item of page.items) items.set(item.id, item);
          cursor = page.cursor;
          depth += 1;
        } while (cursor && depth < Math.max(1, current.current.depth));
        setSnapshot({ items: [...items.values()], cursor, depth });
      } catch (cause) { if (!request.signal.aborted) setError(errorText(cause)); }
      finally { if (!request.signal.aborted) { busy.current = false; setPending(false); } }
    })();
    return () => request.abort();
  }, [client, repository, number, revision, attempt]);
  const more = async () => {
    const request = controller.current;
    if (!request || request.signal.aborted || busy.current || !current.current.cursor) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const page = await client.activity({ repository, number, cursor: current.current.cursor }, request.signal);
      if (!request.signal.aborted) setSnapshot((value) => ({
        items: [...new Map([...value.items, ...page.items].map((item) => [item.id, item])).values()],
        cursor: page.cursor, depth: value.depth + 1,
      }));
    } catch (cause) { if (!request.signal.aborted) setError(errorText(cause)); }
    finally { if (!request.signal.aborted) { busy.current = false; setPending(false); } }
  };
  return { items: snapshot.items, hasMore: Boolean(snapshot.cursor), pending, error, more, retry };
}
