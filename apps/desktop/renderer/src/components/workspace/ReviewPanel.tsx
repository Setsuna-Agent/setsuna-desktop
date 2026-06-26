import { useEffect, useState } from 'react';
import { Button, Dropdown, type MenuProps } from 'antd';
import { Check, ChevronDown, Code2, RefreshCw } from 'lucide-react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { EmptyState, IconButton } from '../primitives.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';
import type { DesktopDiffFile, DesktopDiffSummary, DesktopReviewState } from './model.js';

type DesktopReviewSource = 'unstaged' | 'staged' | 'branch' | 'latest';

const reviewSourceLabels: Record<DesktopReviewSource, string> = {
  branch: '分支',
  latest: '上轮对话',
  staged: '已暂存',
  unstaged: '未暂存',
};

const reviewEmptyText: Record<DesktopReviewSource, { title: string; description: string }> = {
  branch: {
    title: '无分支更改',
    description: '当前分支暂无可审核内容',
  },
  latest: {
    title: '无可审核更改',
    description: '接受编辑内容后可在这里查看',
  },
  staged: {
    title: '无暂存更改',
    description: '接受编辑内容并暂存',
  },
  unstaged: {
    title: '无未暂存更改',
    description: '当前工作区暂无未暂存内容',
  },
};

const reviewSourceOptions: Array<{ key: DesktopReviewSource; label: string }> = [
  { key: 'unstaged', label: '未暂存' },
  { key: 'staged', label: '已暂存' },
  { key: 'branch', label: '分支' },
  { key: 'latest', label: '上轮对话' },
];

export function DesktopReviewPanel({
  activeProject,
  error,
  latestSummary,
  loading,
  reviewState,
  onExternalOpenFile,
  onOpenProjectFile,
  onRefresh,
}: {
  activeProject?: WorkspaceProject;
  error: string | null;
  latestSummary: DesktopDiffSummary | null;
  loading: boolean;
  reviewState: DesktopReviewState | null;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenProjectFile: (filePath: string) => void;
  onRefresh: () => void;
}) {
  const [reviewSource, setReviewSource] = useState<DesktopReviewSource>('unstaged');
  const hasGit = Boolean(reviewState?.isGitRepository);
  const activeSource = hasGit ? reviewSource : 'latest';

  useEffect(() => {
    if (reviewState && !reviewState.isGitRepository) setReviewSource('latest');
  }, [reviewState]);

  if (!activeProject) {
    return (
      <section className="desktop-review-panel">
        <EmptyState title="未选择项目" body="先在左侧添加项目目录。" />
      </section>
    );
  }
  if (loading && !reviewState && !latestSummary?.files.length) {
    return (
      <section className="desktop-review-panel">
        <EmptyState title="正在加载审查信息" body={activeProject.path} />
      </section>
    );
  }
  if (error && !latestSummary?.files.length) {
    return (
      <section className="desktop-review-panel">
        <EmptyState title="无法加载审查信息" body={error} />
      </section>
    );
  }

  const activeSummary = reviewSummaryForSource(reviewState, activeSource, latestSummary);
  const sourceMenuItems: MenuProps['items'] = reviewSourceOptions.map((item) => ({
    key: item.key,
    label: (
      <span className="chat-file-review-panel__source-menu-item">
        <span>{item.label}</span>
        <span className="chat-file-review-panel__source-menu-check">{activeSource === item.key ? <Check size={13} /> : null}</span>
      </span>
    ),
  }));
  const handleSourceMenuClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    setReviewSource(key as DesktopReviewSource);
  };

  return (
    <section className="desktop-review-panel">
      <header className="desktop-review-panel__toolbar">
        <div className="chat-file-review-panel__toolbar">
          {hasGit ? (
            <Dropdown
              rootClassName="chat-file-review-panel__source-menu"
              trigger={['click']}
              placement="bottomLeft"
              menu={{
                items: sourceMenuItems,
                selectedKeys: [activeSource],
                onClick: handleSourceMenuClick,
              }}
            >
              <Button className="chat-file-review-panel__source-button" type="text" size="small">
                <span>{reviewSourceLabels[activeSource]}</span>
                <ChevronDown className="chat-file-review-panel__source-caret" size={12} />
              </Button>
            </Dropdown>
          ) : (
            <span className="chat-file-review-panel__source-title">最新改动</span>
          )}
          <div className="desktop-review-change-counts">
            <span className="desktop-review-change-counts__addition">+{activeSummary?.additions ?? 0}</span>
            <span className="desktop-review-change-counts__deletion">-{activeSummary?.deletions ?? 0}</span>
          </div>
        </div>
        <IconButton className="desktop-review-panel__refresh" label="Refresh review" variant="ghost" onClick={onRefresh}>
          <RefreshCw size={14} />
        </IconButton>
      </header>
      <div className="desktop-review-panel__sections">
        <ReviewSummarySection
          emptyText={reviewEmptyText[activeSource]}
          summary={activeSummary}
          onExternalOpenFile={onExternalOpenFile}
          onOpenProjectFile={onOpenProjectFile}
        />
      </div>
    </section>
  );
}

function reviewSummaryForSource(
  reviewState: DesktopReviewState | null,
  source: DesktopReviewSource,
  latestSummary: DesktopDiffSummary | null,
): DesktopDiffSummary | null {
  if (source === 'latest') return latestSummary;
  if (source === 'unstaged') return reviewState?.unstagedSummary ?? null;
  if (source === 'staged') return reviewState?.stagedSummary ?? null;
  if (source === 'branch') return reviewState?.branchSummary ?? null;
  return null;
}

function ReviewSummarySection({
  emptyText,
  summary,
  onExternalOpenFile,
  onOpenProjectFile,
}: {
  emptyText: { title: string; description: string };
  summary: DesktopDiffSummary | null;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenProjectFile: (filePath: string) => void;
}) {
  const files = summary?.files ?? [];
  return (
    <section className="desktop-review-section">
      {files.length ? (
        <div className="desktop-review-file-list">
          {files.map((file) => (
            <ReviewFileCard
              file={file}
              key={file.path}
              onExternalOpenFile={onExternalOpenFile}
              onOpenProjectFile={onOpenProjectFile}
            />
          ))}
        </div>
      ) : (
        <div className="desktop-review-empty desktop-review-empty--panel">
          <strong>{emptyText.title}</strong>
          <span>{emptyText.description}</span>
        </div>
      )}
    </section>
  );
}

function ReviewFileCard({
  file,
  onExternalOpenFile,
  onOpenProjectFile,
}: {
  file: DesktopDiffFile;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenProjectFile: (filePath: string) => void;
}) {
  const visibleLines = file.lines.slice(0, 36);
  return (
    <article className="desktop-review-file-card">
      <header>
        <button type="button" onClick={() => onOpenProjectFile(file.path)}>
          <WorkspaceFileIcon path={file.path} type="file" />
          <span className="desktop-review-file-card__path" title={file.path}>{file.path}</span>
        </button>
        <div>
          <span>{file.action}</span>
          <em>+{file.additions} -{file.deletions}</em>
          <IconButton label="Open in workspace app" variant="ghost" onClick={() => onExternalOpenFile(file.path)}>
            <Code2 size={13} />
          </IconButton>
        </div>
      </header>
      {visibleLines.length ? (
        <div className="desktop-review-diff">
          {visibleLines.map((line) => (
            <button
              className={`desktop-review-diff-line desktop-review-diff-line--${line.type}`}
              key={`${file.path}:${line.lineNumber}`}
              type="button"
              onClick={() => onExternalOpenFile(file.path, line.newLine ?? line.oldLine)}
            >
              <span>{line.newLine ?? line.oldLine ?? ''}</span>
              <code>{line.content || ' '}</code>
            </button>
          ))}
          {file.truncated ? <div className="desktop-review-truncated">diff 过大，已截断展示。</div> : null}
        </div>
      ) : null}
    </article>
  );
}
