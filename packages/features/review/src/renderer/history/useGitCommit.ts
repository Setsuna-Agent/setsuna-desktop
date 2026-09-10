import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopGitChangedFile } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { errorMessage } from './useGitHistory.js';

export function useGitCommitDetails(workspaceRoot: string, oid: string | null) {
  const { bridge } = useReviewRendererHost();
  const read = useCallback(() => {
    if (!bridge || !oid) throw new Error('Git history is unavailable.');
    return bridge.getCommitDetails(workspaceRoot, oid);
  }, [bridge, oid, workspaceRoot]);
  return useCommitResource(oid ? JSON.stringify([workspaceRoot, oid]) : null, read);
}

export function useGitCommitFile(workspaceRoot: string, oid: string | null, file: DesktopGitChangedFile | null) {
  const { bridge } = useReviewRendererHost();
  const filePath = file?.path;
  const previousPath = file?.previousPath;
  const read = useCallback(() => {
    if (!bridge || !oid || !filePath) throw new Error('Git history is unavailable.');
    return bridge.getCommitFileDiff(workspaceRoot, { oid, filePath, previousPath });
  }, [bridge, filePath, oid, previousPath, workspaceRoot]);
  return useCommitResource(oid && filePath ? JSON.stringify([workspaceRoot, oid, filePath, previousPath]) : null, read);
}

/** Key both the response and its lifetime so a previous project/commit never flashes on selection. */
function useCommitResource<T>(key: string | null, read: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    if (!key) return;
    let disposed = false;
    setState({ key });
    void Promise.resolve().then(read).then((data) => {
      if (!disposed && currentKey.current === key) setState({ key, data });
    }).catch((reason: unknown) => {
      if (!disposed && currentKey.current === key) setState({ key, error: errorMessage(reason) });
    });
    return () => { disposed = true; };
  }, [key, read, retryVersion]);
  const current = state?.key === key ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: Boolean(key && !current?.data && !current?.error),
    retry: () => setRetryVersion((value) => value + 1),
  };
}
