import { Virtualizer } from '@pierre/diffs/react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ComponentProps,
} from 'react';
import type { DesktopDiffSummary } from '../contracts/index.js';
import { ReviewSummarySection } from './ReviewDiffView.js';
import { ReviewFileNavigator } from './ReviewFileNavigator.js';
import { resolveReviewFile } from './review-findings.js';

const reviewFilePathCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});
const SINGLE_FILE_EXPANSION_REQUEST = { expanded: true, version: 0 } as const;

type ReviewFileBrowserProps = Omit<
  ComponentProps<typeof ReviewSummarySection>,
  'fileExpansionRequest' | 'summary'
> & {
  selectionKey: string;
  summary: DesktopDiffSummary;
};

/**
 * Large reviews keep exactly one diff renderer mounted. The adjacent navigator
 * owns its UI state so directory interactions cannot rerender the heavy diff.
 */
export function ReviewFileBrowser({
  focusRequest,
  selectionKey,
  summary,
  ...summarySectionProps
}: ReviewFileBrowserProps) {
  const [selectedPathByKey, setSelectedPathByKey] = useState<Record<string, string>>({});
  const handledFocusKeyRef = useRef<string | null>(null);
  const files = useMemo(
    () => [...summary.files].sort((left, right) => (
      reviewFilePathCollator.compare(left.path, right.path)
    )),
    [summary.files],
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
    // Once the user chooses a file, a still-mounted historical focus request
    // must not pull the selection back on the next unrelated parent render.
    handledFocusKeyRef.current = focusKey;
    setSelectedPathByKey((current) => (
      current[selectionKey] === filePath
        ? current
        : { ...current, [selectionKey]: filePath }
    ));
  }, [focusKey, selectionKey]);
  const selectedSummary = useMemo<DesktopDiffSummary | null>(() => (
    selectedFile
      ? {
          additions: selectedFile.additions,
          deletions: selectedFile.deletions,
          files: [selectedFile],
        }
      : null
  ), [selectedFile]);
  const selectedFocusRequest = focusedFile === selectedFile ? focusRequest : null;

  return (
    <div className="desktop-review-file-browser">
      <Virtualizer
        className="desktop-review-panel__sections desktop-review-file-browser__diff"
        contentClassName="desktop-review-panel__sections-content"
      >
        <ReviewSummarySection
          {...summarySectionProps}
          fileExpansionRequest={SINGLE_FILE_EXPANSION_REQUEST}
          focusRequest={selectedFocusRequest}
          summary={selectedSummary}
        />
      </Virtualizer>
      <ReviewFileNavigator
        files={files}
        selectedPath={selectedFile?.path ?? null}
        onSelect={selectFile}
      />
    </div>
  );
}
