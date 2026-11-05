import { Virtualizer } from '@pierre/diffs/react';
import { useMemo, type ComponentProps } from 'react';
import type { DesktopDiffFile, DesktopDiffSummary } from '../contracts/index.js';
import { ReviewSummarySection } from './ReviewDiffView.js';
import { ReviewFileNavigator } from './ReviewFileNavigator.js';

const SINGLE_FILE_EXPANSION_REQUEST = { expanded: true, version: 0 } as const;

type ReviewFileBrowserProps = Omit<
  ComponentProps<typeof ReviewSummarySection>,
  'fileExpansionRequest' | 'summary'
> & {
  files: DesktopDiffFile[];
  selectedFile: DesktopDiffFile | null;
  navigatorVisible: boolean;
  onSelectFile(filePath: string): void;
};

/**
 * Large reviews keep exactly one diff renderer mounted. The adjacent navigator
 * owns filter, layout and width state so directory interactions cannot rerender the heavy diff.
 */
export function ReviewFileBrowser({
  files,
  navigatorVisible,
  selectedFile,
  onSelectFile,
  ...summarySectionProps
}: ReviewFileBrowserProps) {
  const selectedSummary = useMemo<DesktopDiffSummary | null>(() => (
    selectedFile
      ? {
          additions: selectedFile.additions,
          deletions: selectedFile.deletions,
          files: [selectedFile],
        }
      : null
  ), [selectedFile]);

  return (
    <div className="desktop-review-file-browser">
      <Virtualizer
        className="desktop-review-panel__sections desktop-review-file-browser__diff"
        contentClassName="desktop-review-panel__sections-content"
      >
        <ReviewSummarySection
          {...summarySectionProps}
          fileExpansionRequest={SINGLE_FILE_EXPANSION_REQUEST}
          summary={selectedSummary}
        />
      </Virtualizer>
      <ReviewFileNavigator
        visible={navigatorVisible}
        files={files}
        selectedPath={selectedFile?.path ?? null}
        onSelect={onSelectFile}
      />
    </div>
  );
}
