import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopDiffFile, DesktopDiffSummary, DesktopReviewFocusRequest } from '../../contracts/index.js';
import { resolveReviewFile } from '../review-findings.js';

const EMPTY_FILES: DesktopDiffFile[] = [];
const reviewFilePathCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

/** The toolbar and single-file renderer share selection, including pending focus requests. */
export function useReviewFileSelection({ summary, selectionKey, focusRequest }: {
  summary: DesktopDiffSummary | null;
  selectionKey: string;
  focusRequest?: DesktopReviewFocusRequest | null;
}) {
  const [selectedPathByKey, setSelectedPathByKey] = useState<Record<string, string>>({});
  const handledFocusKeyRef = useRef<string | null>(null);
  const sourceFiles = summary?.files ?? EMPTY_FILES;
  const files = useMemo(
    () => [...sourceFiles].sort((left, right) => reviewFilePathCollator.compare(left.path, right.path)),
    [sourceFiles],
  );
  const focusedFile = useMemo(() => (
    focusRequest?.path ? resolveReviewFile(summary, focusRequest.path) : null
  ), [focusRequest?.path, summary]);
  const focusKey = focusedFile && focusRequest
    ? JSON.stringify([selectionKey, focusedFile.path, focusRequest.version])
    : null;
  const pendingFocusedFile = focusKey && handledFocusKeyRef.current !== focusKey
    ? focusedFile
    : null;
  const savedFile = files.find((file) => file.path === selectedPathByKey[selectionKey]);
  const selectedFile = pendingFocusedFile ?? savedFile ?? files[0] ?? null;

  useEffect(() => {
    if (!focusKey || !focusedFile || handledFocusKeyRef.current === focusKey) return;
    handledFocusKeyRef.current = focusKey;
    setSelectedPathByKey((current) => (
      current[selectionKey] === focusedFile.path
        ? current
        : { ...current, [selectionKey]: focusedFile.path }
    ));
  }, [focusKey, focusedFile, selectionKey]);

  const selectFile = useCallback((filePath: string) => {
    // A still-mounted historical focus request must not undo a later manual selection.
    handledFocusKeyRef.current = focusKey;
    setSelectedPathByKey((current) => (
      current[selectionKey] === filePath
        ? current
        : { ...current, [selectionKey]: filePath }
    ));
  }, [focusKey, selectionKey]);

  return {
    files,
    selectedFile,
    selectedFocusRequest: focusedFile === selectedFile ? focusRequest : null,
    selectFile,
  };
}
