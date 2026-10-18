import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DesktopDiffFile, DesktopDiffSummary, DesktopFileChangeReference } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';

export type RequestReviewFilePreview = (reference: DesktopFileChangeReference, signal: AbortSignal) => Promise<void>;

function referenceKey(reference?: DesktopFileChangeReference): string {
  return reference ? JSON.stringify([reference.threadId, reference.path, reference.toolCallIds]) : '';
}

/** Hydrate the summary itself so finding anchors and file cards see identical
 * lines. Retain only previews belonging to the current summary, never history. */
export function useReviewFilePreviews(summary: DesktopDiffSummary | null) {
  const { loadFileChangePreview } = useReviewRendererHost();
  const [previews, setPreviews] = useState<Map<string, DesktopDiffFile>>(() => new Map());
  const keys = useMemo(() => new Set(summary?.files.map((file) => referenceKey(file.changeReference)).filter(Boolean)), [summary?.files]);
  useEffect(() => {
    setPreviews((previous) => {
      if ([...previous.keys()].every((key) => keys.has(key))) return previous;
      return new Map([...previous].filter(([key]) => keys.has(key)));
    });
  }, [keys]);
  const requestPreview = useCallback<RequestReviewFilePreview>(async (reference, signal) => {
    const preview = await loadFileChangePreview(reference, signal);
    if (signal.aborted) return;
    setPreviews((previous) => new Map(previous).set(referenceKey(reference), preview));
  }, [loadFileChangePreview]);
  const hydratedSummary = useMemo(() => {
    if (!summary) return null;
    let changed = false;
    const files = summary.files.map((file) => {
      const preview = previews.get(referenceKey(file.changeReference));
      if (!preview) return file;
      changed = true;
      // Preserve the selected root's display path and the complete operation totals.
      return { ...file, lines: preview.lines, truncated: preview.truncated, patch: preview.patch, changeReference: undefined };
    });
    return changed ? { ...summary, files } : summary;
  }, [previews, summary]);
  return { summary: hydratedSummary, requestPreview };
}

export function useReviewFilePreviewRequest(
  reference: DesktopFileChangeReference | undefined,
  enabled: boolean,
  requestPreview: RequestReviewFilePreview,
) {
  const key = referenceKey(reference);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    if (!enabled || !key) return;
    const controller = new AbortController();
    // Key by operation identity, not snapshot object identity: polling must not
    // cancel and restart an unchanged preview request.
    const [threadId, path, toolCallIds] = JSON.parse(key) as [string, string, string[]];
    void requestPreview({ threadId, path, toolCallIds }, controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => controller.abort();
  }, [enabled, key, requestPreview]);
  return { loading: enabled && Boolean(key) && !error, error: enabled && key ? error : null };
}
