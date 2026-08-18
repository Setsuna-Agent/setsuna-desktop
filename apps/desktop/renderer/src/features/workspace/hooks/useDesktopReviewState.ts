import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';
import type { DesktopReviewState } from '../model.js';
import {
  normalizeReviewBaseRefPreference,
  readReviewBaseRefPreference,
  reviewBaseRefPreferenceKey,
  writeReviewBaseRefPreference,
} from '../model/reviewBaseRefPreference.js';

type DesktopReviewStateOptions = {
  activeProject: WorkspaceProject | null | undefined;
};

type ReviewLoadRequest = {
  baseRef: string | null;
  foreground: boolean;
  persistPreference: boolean;
};

export function useDesktopReviewState({ activeProject }: DesktopReviewStateOptions) {
  const [reviewState, setReviewState] = useState<DesktopReviewState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewRequests = useLatestRequestGuard();
  const preferredBaseRefRef = useRef<string | null>(null);
  const reviewStateRef = useRef<DesktopReviewState | null>(null);
  const loadingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const refreshCurrentRef = useRef<() => void>(() => undefined);
  const projectPath = activeProject?.path ?? null;
  const preferenceKey = activeProject ? reviewBaseRefPreferenceKey(activeProject) : null;
  // The initial subscription already resolves the current repository. Only a
  // confirmed non-Git workspace needs a new subscription after Git appears.
  const reviewRepositoryKey = reviewState?.isGitRepository === false ? 'not-git' : 'watch';

  const runReviewLoad = useCallback(async (
    targetProjectPath: string,
    targetPreferenceKey: string,
    request: ReviewLoadRequest,
  ) => {
    const { baseRef, foreground, persistPreference } = request;
    const api = window.setsunaDesktop?.desktopReview;
    if (!api) {
      setReviewError('Desktop review bridge is unavailable.');
      return;
    }
    const isLatest = reviewRequests.begin();
    loadingRef.current = true;
    if (foreground) setReviewLoading(true);
    setReviewError(null);
    try {
      let state = await api.getState(targetProjectPath, { baseRef });
      if (!isLatest()) return;
      if (persistPreference) {
        const normalizedBaseRef = normalizeReviewBaseRefPreference(baseRef, state.baseRefs);
        if (normalizedBaseRef && normalizedBaseRef !== state.baseRef) {
          state = await api.getState(targetProjectPath, { baseRef: normalizedBaseRef });
          if (!isLatest()) return;
        }
        preferredBaseRefRef.current = state.baseRef === normalizedBaseRef ? normalizedBaseRef : null;
        writeReviewBaseRefPreference(targetPreferenceKey, preferredBaseRefRef.current);
      }
      reviewStateRef.current = state;
      setReviewState(state);
    } catch (unknownError) {
      if (!isLatest()) return;
      // Background refreshes keep the last successful snapshot visible.
      if (foreground || !reviewStateRef.current) setReviewState(null);
      setReviewError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      if (isLatest()) {
        loadingRef.current = false;
        setReviewLoading(false);
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          queueMicrotask(() => refreshCurrentRef.current());
        }
      }
    }
  }, [reviewRequests]);

  const loadReviewState = useCallback(async () => {
    if (!projectPath || !preferenceKey) return;
    await runReviewLoad(projectPath, preferenceKey, {
      baseRef: preferredBaseRefRef.current,
      foreground: true,
      persistPreference: false,
    });
  }, [preferenceKey, projectPath, runReviewLoad]);

  const refreshReviewState = useCallback(async () => {
    if (!projectPath || !preferenceKey) return;
    await runReviewLoad(projectPath, preferenceKey, {
      baseRef: preferredBaseRefRef.current,
      foreground: false,
      persistPreference: false,
    });
  }, [preferenceKey, projectPath, runReviewLoad]);

  const selectReviewBaseRef = useCallback(async (baseRef: string) => {
    if (!projectPath || !preferenceKey) return;
    await runReviewLoad(projectPath, preferenceKey, {
      baseRef,
      foreground: true,
      persistPreference: true,
    });
  }, [preferenceKey, projectPath, runReviewLoad]);

  refreshCurrentRef.current = () => {
    if (!projectPath) return;
    if (loadingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    void refreshReviewState();
  };

  useEffect(() => {
    reviewRequests.invalidate();
    pendingRefreshRef.current = false;
    loadingRef.current = false;
    reviewStateRef.current = null;
    setReviewState(null);
    setReviewError(null);
    setReviewLoading(false);
    if (!projectPath || !preferenceKey) {
      preferredBaseRefRef.current = null;
      return undefined;
    }

    preferredBaseRefRef.current = readReviewBaseRefPreference(preferenceKey);
    void runReviewLoad(projectPath, preferenceKey, {
      baseRef: preferredBaseRefRef.current,
      foreground: true,
      persistPreference: preferredBaseRefRef.current !== null,
    });
    const handleWindowFocus = () => refreshCurrentRef.current();
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      reviewRequests.invalidate();
      pendingRefreshRef.current = false;
      loadingRef.current = false;
    };
  }, [preferenceKey, projectPath, reviewRequests, runReviewLoad]);

  useEffect(() => {
    if (!projectPath) return undefined;
    const api = window.setsunaDesktop?.desktopReview;
    if (!api) return undefined;
    return api.watchChanges(projectPath, () => refreshCurrentRef.current());
  }, [projectPath, reviewRepositoryKey]);

  return {
    loadReviewState,
    reviewError,
    reviewLoading,
    reviewState,
    selectReviewBaseRef,
  };
}
