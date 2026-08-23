import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';
import type { DesktopReviewState } from '../model.js';
import type { DesktopReviewSource } from '../review-types.js';
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
  includeBranchSummary: boolean;
  preferenceMode: 'none' | 'restore' | 'select';
};

export function useDesktopReviewState({ activeProject }: DesktopReviewStateOptions) {
  const [reviewState, setReviewState] = useState<DesktopReviewState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewRequests = useLatestRequestGuard();
  const branchSummaryRequestedRef = useRef(false);
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
    const { baseRef, foreground, includeBranchSummary, preferenceMode } = request;
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
      let state = await api.getState(targetProjectPath, { baseRef, includeBranchSummary });
      if (!isLatest()) return;
      if (preferenceMode !== 'none') {
        // Stored preferences may need migration to a remote counterpart, while
        // an explicit selection must preserve the exact local or remote ref.
        const preferredBaseRef = preferenceMode === 'restore'
          ? normalizeReviewBaseRefPreference(baseRef, state.baseRefs)
          : baseRef;
        if (preferenceMode === 'restore' && preferredBaseRef && preferredBaseRef !== state.baseRef) {
          state = await api.getState(targetProjectPath, {
            baseRef: preferredBaseRef,
            includeBranchSummary,
          });
          if (!isLatest()) return;
        }
        preferredBaseRefRef.current = state.baseRef === preferredBaseRef ? preferredBaseRef : null;
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
      includeBranchSummary: branchSummaryRequestedRef.current,
      preferenceMode: 'none',
    });
  }, [preferenceKey, projectPath, runReviewLoad]);

  const refreshReviewState = useCallback(async () => {
    if (!projectPath || !preferenceKey) return;
    await runReviewLoad(projectPath, preferenceKey, {
      baseRef: preferredBaseRefRef.current,
      foreground: false,
      includeBranchSummary: branchSummaryRequestedRef.current,
      preferenceMode: 'none',
    });
  }, [preferenceKey, projectPath, runReviewLoad]);

  const selectReviewBaseRef = useCallback(async (baseRef: string) => {
    if (!projectPath || !preferenceKey) return;
    branchSummaryRequestedRef.current = true;
    await runReviewLoad(projectPath, preferenceKey, {
      baseRef,
      foreground: true,
      includeBranchSummary: true,
      preferenceMode: 'select',
    });
  }, [preferenceKey, projectPath, runReviewLoad]);

  const setReviewSource = useCallback((source: DesktopReviewSource) => {
    const includeBranchSummary = source === 'branch';
    if (branchSummaryRequestedRef.current === includeBranchSummary) return;
    branchSummaryRequestedRef.current = includeBranchSummary;
    if (includeBranchSummary) {
      refreshCurrentRef.current();
      return;
    }

    // Switching away from a branch comparison should immediately release its
    // potentially very large payload. In-flight branch loads are invalidated so
    // they cannot reintroduce the discarded snapshot after this source change.
    reviewRequests.invalidate();
    pendingRefreshRef.current = false;
    loadingRef.current = false;
    setReviewLoading(false);
    const current = reviewStateRef.current;
    if (!current?.branchSummary && !current?.currentRemoteSummary) return;
    const next = {
      ...current,
      branchSummary: null,
      currentRemoteSummary: null,
    };
    reviewStateRef.current = next;
    setReviewState(next);
  }, [reviewRequests]);

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
    branchSummaryRequestedRef.current = false;
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
      includeBranchSummary: false,
      preferenceMode: preferredBaseRefRef.current === null ? 'none' : 'restore',
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
    setReviewSource,
  };
}
