import { useCallback, useEffect, useRef, useState } from 'react';
import type { PullRequestFilters, PullRequestRepositories, PullRequestSummary } from '../contracts/index.js';
import type { PullRequestsClient } from './client.js';
import { errorText } from './context.js';

type RepositoryPage = { items: PullRequestSummary[]; cursor: string | null; depth: number; error: string };
export function usePullRequestList(client: PullRequestsClient, account: string | null, repository: string, filters: PullRequestFilters) {
  const [inventory, setInventory] = useState<PullRequestRepositories>({ repositories: [], issues: [] });
  const [pages, setPages] = useState<Record<string, RepositoryPage>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const currentPages = useRef(pages);
  currentPages.current = pages;
  const key = JSON.stringify([account, repository, filters]);
  const previousKey = useRef(key);

  useEffect(() => {
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    const reset = previousKey.current !== key;
    previousKey.current = key;
    if (reset) setPages({});
    if (!account) { setPages({}); setLoading(false); return () => request.abort(); }
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const repos = await client.repositories({}, request.signal);
          if (request.signal.aborted) return;
          setInventory(repos);
          setError('');
          const selected = repos.repositories.filter((item) => !repository || item.id === repository);
          if (!selected.length) setPages({});
          await Promise.all(selected.map(async (item) => {
            try {
              let cursor: string | null = null;
              let depth = 0;
              const items = new Map<string, PullRequestSummary>();
              const targetDepth = reset ? 1 : currentPages.current[item.id]?.depth ?? 1;
              do {
                const result = await client.list({ repository: item.id, cursor, filters }, request.signal);
                for (const pr of result.items) items.set(pr.id, pr);
                cursor = result.cursor;
                depth += 1;
              } while (cursor && depth < targetDepth);
              if (!request.signal.aborted) setPages((current) => ({ ...current, [item.id]: { items: [...items.values()], cursor, depth, error: '' } }));
            } catch (cause) {
              if (!request.signal.aborted) setPages((current) => ({ ...current, [item.id]: { items: current[item.id]?.items ?? [], cursor: current[item.id]?.cursor ?? null, depth: current[item.id]?.depth ?? 1, error: errorText(cause) } }));
            }
          }));
          if (!request.signal.aborted) {
            const ids = new Set(selected.map((item) => item.id));
            setPages((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
          }
        } catch (cause) { if (!request.signal.aborted) setError(errorText(cause)); }
        finally { if (!request.signal.aborted) setLoading(false); }
      })();
    }, reset ? 300 : 0);
    return () => { clearTimeout(timer); request.abort(); };
  // A stable serialized filter prevents object identities from restarting network work.
  }, [client, key, revision]);

  const more = async () => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || loading) return;
    setLoading(true);
    try {
      await Promise.all(Object.entries(currentPages.current).filter(([, page]) => page.cursor).map(async ([id, page]) => {
        try {
          const result = await client.list({ repository: id, cursor: page.cursor, filters }, signal);
          if (!signal.aborted) setPages((current) => ({ ...current, [id]: { ...result, depth: page.depth + 1, error: '', items: [...new Map([...(current[id]?.items ?? []), ...result.items].map((item) => [item.id, item])).values()] } }));
        } catch (cause) { if (!signal.aborted) setPages((current) => ({ ...current, [id]: { ...page, error: errorText(cause) } })); }
      }));
    } finally { if (!signal.aborted) setLoading(false); }
  };
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  const visiblePages = previousKey.current === key && account ? pages : {};
  const items = Object.values(visiblePages).flatMap((page) => page.items).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { inventory, items, loading, error, refresh, more, hasMore: Object.values(visiblePages).some((page) => page.cursor), errors: Object.entries(visiblePages).filter(([, page]) => page.error).map(([repository, page]) => ({ repository, message: page.error })) };
}
