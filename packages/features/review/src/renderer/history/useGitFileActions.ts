import { useEffect, useRef, useState } from 'react';
import type { DesktopGitChangedFile } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { errorMessage } from './useGitHistory.js';

export type GitFileAction = 'stage' | 'unstage' | 'discard';

export function useGitFileActions(workspaceRoot: string, onRefresh: () => void) {
  const { bridge, translate: t } = useReviewRendererHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<object | null>(null);
  useEffect(() => () => { request.current = null; }, [workspaceRoot]);

  const run = async (action: GitFileAction, files: DesktopGitChangedFile[]) => {
    if (!bridge || request.current || !files.length) return false;
    if (action === 'discard' && !window.confirm(files.length === 1
      ? t('feature.review.history.discardConfirm', { path: files[0].path })
      : t('feature.review.history.discardGroupConfirm', { count: files.length }))) return false;
    const token = {};
    request.current = token;
    setBusy(true);
    setError(null);
    try {
      // A rename is a single list entry but updates both names in the index.
      const paths = [...new Set(files.flatMap((file) => file.previousPath ? [file.previousPath, file.path] : [file.path]))];
      if (action === 'stage') await bridge.stageFiles(workspaceRoot, paths);
      else if (action === 'unstage') await bridge.unstageFiles(workspaceRoot, paths);
      else await bridge.discardUnstaged(workspaceRoot, paths);
      if (request.current !== token) return false;
      onRefresh();
      return true;
    } catch (reason) {
      if (request.current === token) setError(errorMessage(reason));
      return false;
    } finally {
      if (request.current === token) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return { busy, error, run, clearError: () => setError(null) };
}
