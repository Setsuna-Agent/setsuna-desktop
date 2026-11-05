import { Button } from '@setsuna-desktop/renderer-ui';
import { Virtualizer } from '@pierre/diffs/react';
import { FileDiff, GitCommitHorizontal } from 'lucide-react';
import { memo, useMemo, type ComponentProps } from 'react';
import type { DesktopDiffFile, DesktopGitCommitDetails } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { ReviewSummarySection } from '../ReviewDiffView.js';
import type { ReviewFileViewMode } from '../ReviewFileDocument.js';
import type { DesktopReviewDiffLayout, ReviewPathContext } from '../review-types.js';
import { GitAuthorAvatar } from './GitAuthorAvatar.js';

export type GitHistoryFileActions = Pick<ComponentProps<typeof ReviewSummarySection>,
  'workspaceApp' | 'workspaceApps' | 'onAddFileToConversation' | 'onCopyFilePath' | 'onExternalOpenFile'
  | 'onOpenFileWithApp' | 'onOpenProjectFile' | 'onRevealFile'
>;

const EXPANSION = { expanded: true, version: 0 };
const NO_FINDINGS: ComponentProps<typeof ReviewSummarySection>['findings'] = [];

export const GitHistoryDiff = memo(function GitHistoryDiff({
  files, fileView, diffLayout, lineWrap, details, pathContext, selectionKey, loading, error, actions, onRetry,
}: {
  files: DesktopDiffFile[];
  fileView: ReviewFileViewMode;
  diffLayout: DesktopReviewDiffLayout;
  lineWrap: boolean;
  details: DesktopGitCommitDetails | null;
  pathContext: ReviewPathContext;
  selectionKey: string;
  loading: boolean;
  error: string | null;
  actions: GitHistoryFileActions;
  onRetry: () => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const summary = useMemo(() => ({
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  }), [files]);
  const singleFile = files.length === 1;
  const diffContent = (
    <ReviewSummarySection
      {...actions}
      key={selectionKey}
      summary={summary}
      diffLayout={diffLayout}
      fileView={fileView}
      lineWrap={lineWrap}
      pathContext={pathContext}
      singleFileViewport={singleFile}
      showFileActions={false}
      showFileHeaders={!singleFile}
      emptyText={{ title: t('feature.review.history.emptyFiles'), description: '' }}
      fileExpansionRequest={EXPANSION}
      findings={NO_FINDINGS}
    />
  );
  return (
    <section className="git-history-diff">
      {details ? (
        <div className="git-history-diff__commit">
          <span className="git-history-diff__author">
            <GitAuthorAvatar author={details.commit.author} githubUrl={details.githubUrl} />
            <span>{details.commit.author}<time dateTime={details.commit.authoredAt}>{formatCommitDate(details.commit.authoredAt)}</time></span>
          </span>
          <span className="git-history-diff__revision"><GitCommitHorizontal size={13} /><code>{t('feature.review.history.compare', { base: details.baseOid?.slice(0, 8) ?? t('feature.review.history.root'), commit: details.commit.oid.slice(0, 8) })}</code></span>
          {details.commit.parents.length > 1 ? <span>{t('feature.review.history.firstParent')}</span> : null}
        </div>
      ) : null}
      {error ? <div className="git-history-status" role="alert">{error}<Button variant="ghost" type="button" onClick={onRetry}>{t('feature.review.history.retry')}</Button></div>
        : loading ? <div className="git-history-diff__empty" role="status">{t('feature.review.history.loading')}</div>
          : !files.length ? <div className="git-history-diff__empty"><FileDiff size={30} strokeWidth={1.2} /><span>{t('feature.review.history.emptyFiles')}</span></div>
            : singleFile ? diffContent : (
              <Virtualizer className="desktop-review-panel__sections" contentClassName="desktop-review-panel__sections-content" key={selectionKey}>
                {diffContent}
              </Virtualizer>
            )}
    </section>
  );
});

function formatCommitDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
