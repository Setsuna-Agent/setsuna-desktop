import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopGitHistoryPage, DesktopReviewState } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';

type HistoryState = { key: string; page: DesktopGitHistoryPage };

export function useGitHistory(workspaceRoot: string, reviewState: DesktopReviewState | null) {
  const { bridge } = useReviewRendererHost();
  const [selectedRef, selectRef] = useState('');
  const [state, setState] = useState<HistoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const request = useRef(0);
  const paging = useRef(false);
  const key = JSON.stringify([workspaceRoot, selectedRef]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const page = state?.key === key ? state.page : null;
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    const version = ++request.current;
    let disposed = false;
    paging.current = false;
    setLoadingMore(false);
    if (!bridge) return;
    setLoading(true);
    setError(null);
    void bridge.getHistory(workspaceRoot, { ref: selectedRef || undefined }).then((next) => {
      if (disposed || request.current !== version || currentKey.current !== key) return;
      setState((previous) => {
        const existing = previous?.key === key ? previous.page : null;
        // Worktree invalidations share the existing Review watcher. Keep loaded pages
        // when only files/labels changed, rather than jumping back to the first page.
        const page = existing && existing.tip === next.tip && existing.commits.length > next.commits.length
          ? { ...next, commits: existing.commits, nextSkip: existing.nextSkip }
          : next;
        return { key, page };
      });
    }).catch((reason: unknown) => {
      if (!disposed && request.current === version && currentKey.current === key) setError(errorMessage(reason));
    }).finally(() => {
      if (!disposed && request.current === version && currentKey.current === key) setLoading(false);
    });
    return () => {
      disposed = true;
      if (request.current === version) request.current += 1;
    };
  }, [bridge, key, refreshVersion, reviewState, selectedRef, workspaceRoot]);

  const loadMore = useCallback(async () => {
    const current = pageRef.current;
    if (!bridge || !current?.tip || current.nextSkip === null || paging.current || loading) return;
    const version = request.current;
    paging.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await bridge.getHistory(workspaceRoot, { ref: current.tip, skip: current.nextSkip });
      if (request.current !== version || currentKey.current !== key) return;
      setState((previous) => {
        if (previous?.key !== key || previous.page.tip !== current.tip || previous.page.nextSkip !== current.nextSkip) return previous;
        return { key, page: { ...previous.page, commits: [...previous.page.commits, ...next.commits], nextSkip: next.nextSkip } };
      });
    } catch (reason) {
      if (request.current === version && currentKey.current === key) setError(errorMessage(reason));
    } finally {
      if (request.current === version && currentKey.current === key) {
        paging.current = false;
        setLoadingMore(false);
      }
    }
  }, [bridge, key, loading, workspaceRoot]);

  return { page, selectedRef, selectRef, error, loading, loadingMore, loadMore, refresh: () => setRefreshVersion((value) => value + 1) };
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
