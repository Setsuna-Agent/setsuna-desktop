import { Virtualizer } from '@pierre/diffs/react';
import { ArrowLeft, Columns2, FileDiff, GitCommitHorizontal, Rows3, WrapText } from 'lucide-react';
import { memo, useMemo, useState, type ComponentProps } from 'react';
import type { DesktopDiffFile, DesktopGitCommitDetails } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { ReviewIconButton } from '../primitives.js';
import { ReviewSummarySection } from '../ReviewDiffView.js';
import type { ReviewPathContext } from '../review-types.js';

export type GitHistoryFileActions = Pick<ComponentProps<typeof ReviewSummarySection>,
  'workspaceApp' | 'workspaceApps' | 'onAddFileToConversation' | 'onCopyFilePath' | 'onExternalOpenFile'
  | 'onOpenFileWithApp' | 'onOpenProjectFile' | 'onRevealFile'
>;

const EXPANSION = { expanded: true, version: 0 };
const NO_FINDINGS: ComponentProps<typeof ReviewSummarySection>['findings'] = [];

export const GitHistoryDiff = memo(function GitHistoryDiff({
  files, details, pathContext, selectionKey, loading, error, actions, onRetry, onBack,
}: {
  files: DesktopDiffFile[];
  details: DesktopGitCommitDetails | null;
  pathContext: ReviewPathContext;
  selectionKey: string;
  loading: boolean;
  error: string | null;
  actions: GitHistoryFileActions;
  onRetry: () => void;
  onBack: () => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  const [wrap, setWrap] = useState(true);
  const summary = useMemo(() => ({
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  }), [files]);
  const title = details?.commit.subject ?? (files.length > 1 ? t('feature.review.history.files', { count: files.length }) : files[0]?.path) ?? t('feature.review.history.title');
  return (
    <section className="git-history-diff">
      <div className="desktop-review-panel__toolbar">
        <div className="git-history-diff__heading">
          <ReviewIconButton className="app-shell-icon-control git-history-diff__back" label={t('feature.review.history.back')} onClick={onBack}><ArrowLeft size={15} /></ReviewIconButton>
          <span className="git-history-diff__title" title={title}>{title}</span>
        </div>
        <ReviewIconButton className="app-shell-icon-control" label={t(layout === 'split' ? 'feature.review.workspace.layout.split' : 'feature.review.workspace.layout.unified')} onClick={() => setLayout((value) => value === 'split' ? 'unified' : 'split')}>
          {layout === 'split' ? <Rows3 size={15} /> : <Columns2 size={15} />}
        </ReviewIconButton>
        <ReviewIconButton className={'app-shell-icon-control' + (wrap ? ' is-active' : '')} label={t(wrap ? 'feature.review.workspace.wrap.on' : 'feature.review.workspace.wrap.off')} aria-pressed={wrap} onClick={() => setWrap((value) => !value)}><WrapText size={15} /></ReviewIconButton>
      </div>
      {details ? (
        <div className="git-history-diff__commit">
          <span className="git-history-diff__author">
            <span className="git-history-diff__avatar" aria-hidden="true">{details.commit.author.slice(0, 1).toLocaleUpperCase()}</span>
            <span>{details.commit.author}<time dateTime={details.commit.authoredAt}>{formatCommitDate(details.commit.authoredAt)}</time></span>
          </span>
          <span className="git-history-diff__revision"><GitCommitHorizontal size={13} /><code>{t('feature.review.history.compare', { base: details.baseOid?.slice(0, 8) ?? t('feature.review.history.root'), commit: details.commit.oid.slice(0, 8) })}</code></span>
          {details.commit.parents.length > 1 ? <span>{t('feature.review.history.firstParent')}</span> : null}
        </div>
      ) : null}
      {error ? <div className="git-history-status" role="alert">{error}<button type="button" onClick={onRetry}>{t('feature.review.history.retry')}</button></div>
        : loading ? <div className="git-history-diff__empty" role="status">{t('feature.review.history.loading')}</div>
          : !files.length ? <div className="git-history-diff__empty"><FileDiff size={30} strokeWidth={1.2} /><span>{t(details ? 'feature.review.history.emptyFiles' : 'feature.review.history.choose')}</span></div>
            : (
              <Virtualizer className="desktop-review-panel__sections" contentClassName="desktop-review-panel__sections-content" key={selectionKey}>
                <ReviewSummarySection
                  {...actions}
                  summary={summary}
                  diffLayout={layout}
                  lineWrap={wrap}
                  pathContext={pathContext}
                  emptyText={{ title: t('feature.review.history.emptyFiles'), description: '' }}
                  fileExpansionRequest={EXPANSION}
                  findings={NO_FINDINGS}
                />
              </Virtualizer>
            )}
    </section>
  );
});

function formatCommitDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
