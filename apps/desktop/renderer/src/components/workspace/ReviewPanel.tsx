import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type UIEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Button, Dropdown, type MenuProps } from 'antd';
import { AlignJustify, Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Code2, Columns2, GitBranch, PanelRightOpen, RefreshCw, Rows3, Search, WrapText } from 'lucide-react';
import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { ActionTooltip, EmptyState, IconButton } from '../primitives.js';
import { fileLanguage, highlightedCodeLinesHtml } from './codeHighlight.js';
import { canCompareReviewBranch } from './reviewChanges.js';
import { WorkspaceFileContextMenu, type WorkspaceFileContextTarget } from './WorkspaceFileContextMenu.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';
import type { DesktopDiffFile, DesktopDiffSummary, DesktopReviewFocusRequest, DesktopReviewLoadOptions, DesktopReviewState, DesktopWorkspaceApp } from './model.js';

export type DesktopReviewSource = 'unstaged' | 'staged' | 'branch' | 'latest';
type DesktopReviewDiffLayout = 'unified' | 'split';

export type ReviewPathContext = {
  source: DesktopReviewSource;
  workspaceRoot?: string | null;
  gitRoot?: string | null;
};

type HighlightedReviewDiffLine = {
  highlighted?: string;
  key: string;
  line: DesktopDiffFile['lines'][number];
};

type SplitReviewDiffRow = {
  key: string;
  oldLine: HighlightedReviewDiffLine | null;
  newLine: HighlightedReviewDiffLine | null;
};

type WholeFileReviewChange = 'added' | 'removed';

type ReviewFileExpansionRequest = {
  expanded: boolean;
  version: number;
};

export type BranchCompareRefOption = {
  value: string;
  label: string;
};

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
const REVIEW_REFRESH_FEEDBACK_MS = 650;
const REVIEW_DIFF_VIRTUALIZE_THRESHOLD = 80;
const REVIEW_DIFF_ROW_OVERSCAN = 12;
const REVIEW_DIFF_LINE_HEIGHT_PX = 20;
const REVIEW_DIFF_GAP_HEIGHT_PX = 30;
const REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX = 320;
const REVIEW_DIFF_MAX_WRAPPABLE_LINE_CHARS = 240;
const DEFAULT_REVIEW_LINE_WRAP = true;
const useReviewLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const noopWorkspaceFileAction = () => undefined;

export function DesktopReviewPanel({
  activeProject,
  error,
  focusRequest,
  latestSummary,
  loading,
  reviewState,
  workspaceApp,
  workspaceApps = [],
  onAddFileToConversation = noopWorkspaceFileAction,
  onCopyFilePath = noopWorkspaceFileAction,
  onExternalOpenFile,
  onOpenFileWithApp = noopWorkspaceFileAction,
  onOpenProjectFile,
  onRefresh,
  onRevealFile = noopWorkspaceFileAction,
}: {
  activeProject?: WorkspaceProject;
  error: string | null;
  focusRequest?: DesktopReviewFocusRequest | null;
  latestSummary: DesktopDiffSummary | null;
  loading: boolean;
  reviewState: DesktopReviewState | null;
  workspaceApp?: DesktopWorkspaceApp | null;
  workspaceApps?: DesktopWorkspaceApp[];
  onAddFileToConversation?: (filePath: string) => void;
  onCopyFilePath?: (filePath: string) => void;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenFileWithApp?: (appId: string, filePath: string, line?: number) => void;
  onOpenProjectFile: (filePath: string) => void;
  onRefresh: (options?: DesktopReviewLoadOptions) => void;
  onRevealFile?: (filePath: string) => void;
}) {
  const [reviewSourceByKey, setReviewSourceByKey] = useState<Record<string, DesktopReviewSource>>({});
  const [branchBaseRefByKey, setBranchBaseRefByKey] = useState<Record<string, string>>({});
  const [reviewDiffLayoutByKey, setReviewDiffLayoutByKey] = useState<Record<string, DesktopReviewDiffLayout>>({});
  const [reviewLineWrapByKey, setReviewLineWrapByKey] = useState<Record<string, boolean>>({});
  const [fileExpansionRequest, setFileExpansionRequest] = useState<ReviewFileExpansionRequest>({ expanded: true, version: 0 });
  const [refreshFeedbackVisible, setRefreshFeedbackVisible] = useState(false);
  const refreshFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledFocusRequestKeyRef = useRef<string | null>(null);
  const hasGit = Boolean(reviewState?.isGitRepository);
  const branchComparisonAvailable = canCompareReviewBranch(reviewState);
  const reviewSourceStorageKey = activeProject ? reviewSourcePreferenceKey(activeProject) : null;
  const branchBaseRefStorageKey = activeProject ? branchBaseRefPreferenceKey(activeProject) : null;
  const reviewDiffLayoutStorageKey = activeProject ? reviewDiffLayoutPreferenceKey(activeProject) : null;
  const reviewLineWrapStorageKey = activeProject ? reviewLineWrapPreferenceKey(activeProject) : null;
  const storedReviewSource = useMemo(() => readReviewSourcePreference(reviewSourceStorageKey), [reviewSourceStorageKey]);
  const storedBranchBaseRef = useMemo(() => readBranchBaseRefPreference(branchBaseRefStorageKey), [branchBaseRefStorageKey]);
  const storedReviewDiffLayout = useMemo(() => readReviewDiffLayoutPreference(reviewDiffLayoutStorageKey), [reviewDiffLayoutStorageKey]);
  const storedReviewLineWrap = useMemo(() => readReviewLineWrapPreference(reviewLineWrapStorageKey), [reviewLineWrapStorageKey]);
  const reviewSource = reviewSourceStorageKey
    ? reviewSourceByKey[reviewSourceStorageKey] ?? storedReviewSource ?? 'unstaged'
    : 'unstaged';
  const reviewDiffLayout = reviewDiffLayoutStorageKey
    ? reviewDiffLayoutByKey[reviewDiffLayoutStorageKey] ?? storedReviewDiffLayout ?? 'unified'
    : 'unified';
  const reviewLineWrap = reviewLineWrapStorageKey
    ? reviewLineWrapByKey[reviewLineWrapStorageKey] ?? storedReviewLineWrap ?? DEFAULT_REVIEW_LINE_WRAP
    : DEFAULT_REVIEW_LINE_WRAP;
  const activeSource = hasGit
    ? reviewSource === 'branch' && !branchComparisonAvailable ? 'unstaged' : reviewSource
    : 'latest';
  const availableBaseRefs = reviewState?.baseRefs ?? [];
  const pendingBranchBaseRef = branchBaseRefStorageKey ? branchBaseRefByKey[branchBaseRefStorageKey] : undefined;
  const activeBranchBaseRef = branchBaseRefStorageKey
    ? pendingBranchBaseRef ?? reviewState?.baseRef ?? ''
    : reviewState?.baseRef ?? '';
  const reviewLayoutToggleTip = reviewDiffLayout === 'split'
    ? '当前：左右对比，点击切换为单列对比'
    : '当前：单列对比，点击切换为左右对比';
  const reviewLineWrapToggleTip = reviewLineWrap
    ? '当前：自动换行已开启，点击关闭'
    : '当前：自动换行已关闭，点击开启';
  const reviewRefreshing = loading || refreshFeedbackVisible;
  const reviewRefreshTip = reviewRefreshing ? '正在刷新审查信息' : '刷新审查信息';
  const activeSummary = reviewSummaryForSource(reviewState, activeSource, latestSummary);
  const focusTargetSource = useMemo(
    () => focusRequest?.path ? reviewSourceForFocusPath(focusRequest.path, {
      activeSource,
      latestSummary,
      reviewState,
    }) : null,
    [activeSource, focusRequest?.path, latestSummary, reviewState],
  );
  const focusRequestKey = focusRequest?.path
    ? JSON.stringify([reviewSourceStorageKey, focusRequest.version, normalizeReviewFocusPath(focusRequest.path)])
    : null;

  useEffect(() => {
    if (activeSource !== 'branch') return;
    if (!branchBaseRefStorageKey) return;
    const restoredBaseRef = storedBranchBaseRef;
    if (!restoredBaseRef) return;
    const preferredRestoredBaseRef = preferredBranchCompareRef(restoredBaseRef, availableBaseRefs);
    if (!shouldRestoreBranchBaseRefPreference({
      availableBaseRefs,
      currentBaseRef: reviewState?.baseRef,
      pendingBaseRef: pendingBranchBaseRef,
      storedBaseRef: preferredRestoredBaseRef,
    })) return;
    setBranchBaseRefByKey((current) => ({ ...current, [branchBaseRefStorageKey]: preferredRestoredBaseRef }));
    writeBranchBaseRefPreference(branchBaseRefStorageKey, preferredRestoredBaseRef);
    onRefresh({ baseRef: preferredRestoredBaseRef });
  }, [activeSource, availableBaseRefs, branchBaseRefStorageKey, onRefresh, pendingBranchBaseRef, reviewState?.baseRef, storedBranchBaseRef]);

  useEffect(() => () => {
    if (refreshFeedbackTimerRef.current) clearTimeout(refreshFeedbackTimerRef.current);
  }, []);

  useEffect(() => {
    const consumption = consumeReviewFocusRequest(
      handledFocusRequestKeyRef.current,
      focusRequestKey,
      focusTargetSource,
    );
    handledFocusRequestKeyRef.current = consumption.nextHandledRequestKey;
    if (!consumption.shouldApply || !focusTargetSource) return;
    if (focusTargetSource !== activeSource && reviewSourceStorageKey) {
      setReviewSourceByKey((current) => (
        current[reviewSourceStorageKey] === focusTargetSource ? current : { ...current, [reviewSourceStorageKey]: focusTargetSource }
      ));
      writeReviewSourcePreference(reviewSourceStorageKey, focusTargetSource);
    }
    setFileExpansionRequest((current) => ({ expanded: true, version: current.version + 1 }));
  }, [activeSource, focusRequestKey, focusTargetSource, reviewSourceStorageKey]);

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

  const hasReviewFiles = Boolean(activeSummary?.files.length);
  const reviewFileExpansionTip = fileExpansionRequest.expanded ? '折叠所有文件改动' : '展开所有文件改动';
  const pathContext: ReviewPathContext = {
    source: activeSource,
    workspaceRoot: reviewState?.workspaceRoot ?? activeProject.path,
    gitRoot: reviewState?.gitRoot ?? null,
  };
  const sourceMenuItems: MenuProps['items'] = reviewSourceOptions.map((item) => ({
    disabled: item.key === 'branch' && !branchComparisonAvailable,
    key: item.key,
    label: (
      <span className="chat-file-review-panel__source-menu-item">
        <span>{item.label}</span>
        <span className="chat-file-review-panel__source-menu-check">{activeSource === item.key ? <Check size={13} /> : null}</span>
      </span>
    ),
  }));
  const handleSourceMenuClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (!isDesktopReviewSource(key)) return;
    if (key === 'branch' && !branchComparisonAvailable) return;
    if (reviewSourceStorageKey) {
      setReviewSourceByKey((current) => (
        current[reviewSourceStorageKey] === key ? current : { ...current, [reviewSourceStorageKey]: key }
      ));
      writeReviewSourcePreference(reviewSourceStorageKey, key);
    }
  };
  const handleBranchBaseRefChange = (baseRef: string) => {
    if (branchBaseRefStorageKey) {
      setBranchBaseRefByKey((current) => (
        current[branchBaseRefStorageKey] === baseRef ? current : { ...current, [branchBaseRefStorageKey]: baseRef }
      ));
      writeBranchBaseRefPreference(branchBaseRefStorageKey, baseRef);
    }
    onRefresh({ baseRef });
  };
  const handleReviewDiffLayoutToggle = () => {
    const nextLayout: DesktopReviewDiffLayout = reviewDiffLayout === 'split' ? 'unified' : 'split';
    if (!reviewDiffLayoutStorageKey) return;
    setReviewDiffLayoutByKey((current) => (
      current[reviewDiffLayoutStorageKey] === nextLayout ? current : { ...current, [reviewDiffLayoutStorageKey]: nextLayout }
    ));
    writeReviewDiffLayoutPreference(reviewDiffLayoutStorageKey, nextLayout);
  };
  const handleReviewLineWrapToggle = () => {
    if (!reviewLineWrapStorageKey) return;
    const nextLineWrap = !reviewLineWrap;
    setReviewLineWrapByKey((current) => (
      current[reviewLineWrapStorageKey] === nextLineWrap ? current : { ...current, [reviewLineWrapStorageKey]: nextLineWrap }
    ));
    writeReviewLineWrapPreference(reviewLineWrapStorageKey, nextLineWrap);
  };
  const handleReviewFileExpansionToggle = () => {
    if (!hasReviewFiles) return;
    setFileExpansionRequest((current) => ({ expanded: !current.expanded, version: current.version + 1 }));
  };
  const handleReviewRefresh = () => {
    if (reviewRefreshing) return;
    setRefreshFeedbackVisible(true);
    if (refreshFeedbackTimerRef.current) clearTimeout(refreshFeedbackTimerRef.current);
    refreshFeedbackTimerRef.current = setTimeout(() => {
      setRefreshFeedbackVisible(false);
      refreshFeedbackTimerRef.current = null;
    }, REVIEW_REFRESH_FEEDBACK_MS);
    onRefresh();
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
          <ReviewChangeCounts additions={activeSummary?.additions ?? 0} deletions={activeSummary?.deletions ?? 0} />
        </div>
        <div className="desktop-review-panel__actions">
          <div className="desktop-review-panel__action-group" role="group" aria-label="差异显示">
            <ActionTooltip title={reviewFileExpansionTip}>
              <IconButton
                aria-pressed={!fileExpansionRequest.expanded}
                className="desktop-review-panel__file-expansion-toggle"
                disabled={!hasReviewFiles}
                label={reviewFileExpansionTip}
                title=""
                variant="ghost"
                onClick={handleReviewFileExpansionToggle}
              >
                {fileExpansionRequest.expanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
              </IconButton>
            </ActionTooltip>
            <ActionTooltip title={reviewLayoutToggleTip}>
              <IconButton
                aria-pressed={reviewDiffLayout === 'split'}
                className="desktop-review-panel__layout-toggle"
                label={reviewLayoutToggleTip}
                title=""
                variant="ghost"
                onClick={handleReviewDiffLayoutToggle}
              >
                {reviewDiffLayout === 'split' ? <Rows3 size={14} /> : <Columns2 size={14} />}
              </IconButton>
            </ActionTooltip>
            <ActionTooltip title={reviewLineWrapToggleTip}>
              <IconButton
                aria-pressed={reviewLineWrap}
                className="desktop-review-panel__wrap-toggle"
                label={reviewLineWrapToggleTip}
                title=""
                variant="ghost"
                onClick={handleReviewLineWrapToggle}
              >
                {reviewLineWrap ? <WrapText size={14} /> : <AlignJustify size={14} />}
              </IconButton>
            </ActionTooltip>
          </div>
          <div className="desktop-review-panel__action-group" role="group" aria-label="审查操作">
            <ActionTooltip title={reviewRefreshTip}>
              <IconButton
                aria-disabled={reviewRefreshing}
                aria-busy={reviewRefreshing}
                className={`desktop-review-panel__refresh ${reviewRefreshing ? 'is-refreshing' : ''}`}
                label={reviewRefreshTip}
                title=""
                variant="ghost"
                onClick={handleReviewRefresh}
              >
                <RefreshCw className="desktop-review-panel__refresh-icon" size={14} />
              </IconButton>
            </ActionTooltip>
          </div>
        </div>
      </header>
      {activeSource === 'branch' && hasGit ? (
        <BranchCompareBar
          baseRef={activeBranchBaseRef || reviewState?.baseRef}
          baseRefs={availableBaseRefs}
          currentBranch={reviewState?.currentBranch}
          onBaseRefChange={handleBranchBaseRefChange}
        />
      ) : null}
      <div className="desktop-review-panel__sections">
        <ReviewSummarySection
          emptyText={reviewEmptyText[activeSource]}
          diffLayout={reviewDiffLayout}
          fileExpansionRequest={fileExpansionRequest}
          focusRequest={focusTargetSource === activeSource ? focusRequest : null}
          lineWrap={reviewLineWrap}
          pathContext={pathContext}
          summary={activeSummary}
          workspaceApp={workspaceApp}
          workspaceApps={workspaceApps}
          onAddFileToConversation={onAddFileToConversation}
          onCopyFilePath={onCopyFilePath}
          onExternalOpenFile={onExternalOpenFile}
          onOpenFileWithApp={onOpenFileWithApp}
          onOpenProjectFile={onOpenProjectFile}
          onRevealFile={onRevealFile}
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

function reviewSourceForFocusPath(
  filePath: string,
  {
    activeSource,
    latestSummary,
    reviewState,
  }: {
    activeSource: DesktopReviewSource;
    latestSummary: DesktopDiffSummary | null;
    reviewState: DesktopReviewState | null;
  },
): DesktopReviewSource | null {
  const sourceOrder = uniqueReviewSources([activeSource, 'unstaged', 'staged', 'branch', 'latest']);
  return sourceOrder.find((source) => reviewSummaryHasPath(reviewSummaryForSource(reviewState, source, latestSummary), filePath)) ?? null;
}

function uniqueReviewSources(sources: DesktopReviewSource[]): DesktopReviewSource[] {
  return sources.filter((source, index) => sources.indexOf(source) === index);
}

export function consumeReviewFocusRequest(
  handledRequestKey: string | null,
  requestKey: string | null,
  targetSource: DesktopReviewSource | null,
): { nextHandledRequestKey: string | null; shouldApply: boolean } {
  if (!requestKey) return { nextHandledRequestKey: null, shouldApply: false };
  if (!targetSource || handledRequestKey === requestKey) {
    return { nextHandledRequestKey: handledRequestKey, shouldApply: false };
  }
  return { nextHandledRequestKey: requestKey, shouldApply: true };
}

function reviewSummaryHasPath(summary: DesktopDiffSummary | null, filePath: string): boolean {
  const normalizedTarget = normalizeReviewFocusPath(filePath);
  return Boolean(normalizedTarget && summary?.files.some((file) => normalizeReviewFocusPath(file.path) === normalizedTarget));
}

function normalizeReviewFocusPath(value: string): string | null {
  return normalizeRelativeReviewPath(value)?.toLowerCase() ?? null;
}

function ReviewChangeCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="desktop-review-change-counts">
      <span className="desktop-review-change-counts__addition">+{additions}</span>
      <span className="desktop-review-change-counts__deletion">-{deletions}</span>
    </span>
  );
}

export function reviewFilePathParts(path: string): { directory: string; filename: string } {
  const normalizedPath = path.replace(/\\/gu, '/');
  const separatorIndex = normalizedPath.lastIndexOf('/');
  if (separatorIndex < 0) return { directory: '', filename: normalizedPath };
  return {
    directory: normalizedPath.slice(0, separatorIndex + 1),
    filename: normalizedPath.slice(separatorIndex + 1),
  };
}

function ReviewFilePath({ path }: { path: string }) {
  const { directory, filename } = reviewFilePathParts(path);
  return (
    <span className="desktop-review-file-card__path" title={path}>
      {directory ? <span className="desktop-review-file-card__path-directory">{directory}</span> : null}
      <span className="desktop-review-file-card__path-filename">{filename}</span>
    </span>
  );
}

export function reviewWorkspaceFilePath(filePath: string, context: ReviewPathContext): string | null {
  const normalizedFilePath = normalizeRelativeReviewPath(filePath);
  if (!normalizedFilePath) return null;
  if (context.source === 'latest') return normalizedFilePath;

  const workspaceRoot = normalizeAbsoluteReviewPath(context.workspaceRoot);
  const gitRoot = normalizeAbsoluteReviewPath(context.gitRoot);
  if (!workspaceRoot || !gitRoot) return normalizedFilePath;

  const workspaceRelativePath = relativeReviewPath(workspaceRoot, `${gitRoot}/${normalizedFilePath}`);
  return isSafeWorkspaceRelativePath(workspaceRelativePath) ? workspaceRelativePath : null;
}

function normalizeRelativeReviewPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/gu, '/').replace(/\/+/gu, '/');
  if (!normalized || normalized === '.' || isAbsoluteReviewPath(normalized)) return null;
  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  return segments.join('/') || null;
}

function normalizeAbsoluteReviewPath(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim().replace(/\\/gu, '/');
  if (!normalized) return '';
  if (normalized === '/') return normalized;
  return normalized.replace(/\/+$/u, '');
}

function relativeReviewPath(fromRoot: string, targetPath: string): string {
  const fromParts = splitReviewPath(fromRoot);
  const targetParts = splitReviewPath(normalizeAbsoluteReviewPath(targetPath));
  const windowsPath = isWindowsReviewPath(fromParts);
  let shared = 0;
  while (
    shared < fromParts.length
    && shared < targetParts.length
    && reviewPathSegmentEquals(fromParts[shared], targetParts[shared], windowsPath)
  ) {
    shared += 1;
  }
  return [...fromParts.slice(shared).map(() => '..'), ...targetParts.slice(shared)].join('/') || '.';
}

function splitReviewPath(value: string): string[] {
  if (/^[a-z]:\//iu.test(value)) return [value.slice(0, 2).toLowerCase(), ...value.slice(3).split('/').filter(Boolean)];
  if (value.startsWith('/')) return ['', ...value.slice(1).split('/').filter(Boolean)];
  return value.split('/').filter(Boolean);
}

function isWindowsReviewPath(pathParts: string[]): boolean {
  return Boolean(pathParts[0]?.match(/^[a-z]:$/iu));
}

function reviewPathSegmentEquals(left: string, right: string, windowsPath: boolean): boolean {
  return windowsPath ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isSafeWorkspaceRelativePath(value: string): boolean {
  return Boolean(value && value !== '.' && value !== '..' && !value.startsWith('../') && !isAbsoluteReviewPath(value));
}

function isAbsoluteReviewPath(value: string): boolean {
  return value.startsWith('/') || /^[a-z]:\//iu.test(value);
}

function reviewSourcePreferenceKey(project: WorkspaceProject): string {
  return `setsuna-desktop:review-source:${project.id || project.path}`;
}

function branchBaseRefPreferenceKey(project: WorkspaceProject): string {
  return `setsuna-desktop:review-base-ref:${project.id || project.path}`;
}

function reviewDiffLayoutPreferenceKey(project: WorkspaceProject): string {
  return `setsuna-desktop:review-diff-layout:${project.id || project.path}`;
}

function reviewLineWrapPreferenceKey(project: WorkspaceProject): string {
  return `setsuna-desktop:review-line-wrap:${project.id || project.path}`;
}

function readReviewSourcePreference(key: string | null): DesktopReviewSource | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return isDesktopReviewSource(value) ? value : null;
  } catch {
    return null;
  }
}

function readBranchBaseRefPreference(key: string | null): string | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function readReviewDiffLayoutPreference(key: string | null): DesktopReviewDiffLayout | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return isDesktopReviewDiffLayout(value) ? value : null;
  } catch {
    return null;
  }
}

function readReviewLineWrapPreference(key: string | null): boolean | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    if (value === 'wrap') return true;
    if (value === 'nowrap') return false;
    return null;
  } catch {
    return null;
  }
}

function writeReviewSourcePreference(key: string, source: DesktopReviewSource): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, source);
  } catch {
    // 偏好设置持久化绝不能阻塞审查面板本身。
  }
}

function writeBranchBaseRefPreference(key: string, baseRef: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, baseRef);
  } catch {
    // 偏好设置持久化绝不能阻塞审查面板本身。
  }
}

function writeReviewDiffLayoutPreference(key: string, layout: DesktopReviewDiffLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, layout);
  } catch {
    // 偏好设置持久化绝不能阻塞审查面板本身。
  }
}

function writeReviewLineWrapPreference(key: string, lineWrap: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, lineWrap ? 'wrap' : 'nowrap');
  } catch {
    // 偏好设置持久化绝不能阻塞审查面板本身。
  }
}

function isDesktopReviewSource(value: unknown): value is DesktopReviewSource {
  return typeof value === 'string' && reviewSourceOptions.some((item) => item.key === value);
}

function isDesktopReviewDiffLayout(value: unknown): value is DesktopReviewDiffLayout {
  return value === 'unified' || value === 'split';
}

export function shouldRestoreBranchBaseRefPreference({
  availableBaseRefs,
  currentBaseRef,
  pendingBaseRef,
  storedBaseRef,
}: {
  availableBaseRefs: string[];
  currentBaseRef?: string | null;
  pendingBaseRef?: string;
  storedBaseRef?: string | null;
}): boolean {
  if (!storedBaseRef || !availableBaseRefs.includes(storedBaseRef)) return false;
  if (pendingBaseRef !== undefined) return false;
  return currentBaseRef !== storedBaseRef;
}

function BranchCompareBar({
  baseRef,
  baseRefs,
  currentBranch,
  onBaseRefChange,
}: {
  baseRef?: string | null;
  baseRefs: string[];
  currentBranch?: string | null;
  onBaseRefChange: (baseRef: string) => void;
}) {
  const [query, setQuery] = useState('');
  const selectableBaseRefs = useMemo(() => {
    if (!baseRef || baseRefs.includes(baseRef)) return baseRefs;
    return [baseRef, ...baseRefs];
  }, [baseRef, baseRefs]);
  const selectableOptions = useMemo(() => branchCompareRefOptions(selectableBaseRefs, baseRef), [selectableBaseRefs, baseRef]);
  const selectedBaseValue = preferredBranchCompareRef(baseRef ?? '', selectableBaseRefs);
  const selectedBaseLabel = branchCompareDisplayName(selectedBaseValue) || '未设置';
  const filteredBaseRefs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return selectableOptions;
    return selectableOptions.filter((option) => (
      option.label.toLowerCase().includes(normalizedQuery)
      || option.value.toLowerCase().includes(normalizedQuery)
    ));
  }, [selectableOptions, query]);
  const menuItems: MenuProps['items'] = filteredBaseRefs.length
    ? filteredBaseRefs.map((option) => ({
      key: option.value,
      label: (
        <span className="desktop-review-branch-menu__item">
          <GitBranch size={13} />
          <span>{option.label}</span>
          <span className="desktop-review-branch-menu__check">{branchCompareRefsMatch(baseRef, option.value) ? <Check size={13} /> : null}</span>
        </span>
      ),
    }))
    : [{
      key: '__empty',
      disabled: true,
      label: <span className="desktop-review-branch-menu__empty">无匹配分支</span>,
    }];
  const handleMenuClick: NonNullable<MenuProps['onClick']> = ({ key }) => {
    if (key === '__empty') return;
    onBaseRefChange(String(key));
  };

  return (
    <div className="desktop-review-branch-compare">
      <Dropdown
        rootClassName="desktop-review-branch-dropdown"
        trigger={['click']}
        placement="bottomLeft"
        onOpenChange={(open) => {
          if (!open) setQuery('');
        }}
        popupRender={(menu) => (
          <div className="desktop-review-branch-menu">
            <label className="desktop-review-branch-menu__search">
              <Search size={13} />
              <input
                value={query}
                placeholder="搜索分支"
                onChange={(event) => setQuery(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              />
            </label>
            <div className="desktop-review-branch-menu__label">分支</div>
            {menu}
          </div>
        )}
        menu={{
          items: menuItems,
          selectedKeys: selectedBaseValue ? [selectedBaseValue] : [],
          onClick: handleMenuClick,
        }}
      >
        <Button className="desktop-review-branch-compare__button" type="text" size="small" disabled={!selectableBaseRefs.length}>
          <span className="desktop-review-branch-compare__current">{currentBranch || 'HEAD'}</span>
          <span className="desktop-review-branch-compare__arrow">→</span>
          <span className="desktop-review-branch-compare__base" title={selectedBaseValue || undefined}>{selectedBaseLabel}</span>
          <ChevronDown className="desktop-review-branch-compare__caret" size={12} />
        </Button>
      </Dropdown>
    </div>
  );
}

export function branchCompareRefOptions(refs: string[], selectedRef?: string | null): BranchCompareRefOption[] {
  const options = new Map<string, BranchCompareRefOption>();
  const selectedValue = preferredBranchCompareRef(selectedRef ?? '', refs);
  for (const ref of refs) {
    const logicalName = branchCompareLogicalName(ref);
    if (!logicalName) continue;
    const value = preferredBranchCompareRef(ref, refs);
    const label = branchCompareDisplayName(value);
    const current = options.get(logicalName);
    if (!current || shouldPreferBranchCompareRef(value, current.value, selectedValue)) {
      options.set(logicalName, { value, label });
    }
  }
  return [...options.values()];
}

export function branchCompareDisplayName(ref?: string | null): string {
  const trimmed = String(ref ?? '').trim();
  if (!trimmed || trimmed === 'origin' || trimmed === 'upstream') return '';
  return trimmed;
}

function shouldPreferBranchCompareRef(
  candidate: string,
  current: string,
  selectedRef: string | null,
): boolean {
  if (selectedRef && candidate === selectedRef) return true;
  if (selectedRef && current === selectedRef) return false;
  return !isRemoteCompareRef(current) && isRemoteCompareRef(candidate);
}

function branchCompareRefsMatch(left?: string | null, right?: string | null): boolean {
  const leftName = branchCompareLogicalName(left ?? '');
  return Boolean(leftName && leftName === branchCompareLogicalName(right ?? ''));
}

function branchCompareLogicalName(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return '';
  if (trimmed === 'origin' || trimmed === 'upstream') return '';
  for (const remote of ['origin/', 'upstream/']) {
    if (trimmed.startsWith(remote)) return trimmed.slice(remote.length);
  }
  return trimmed;
}

function preferredBranchCompareRef(ref: string, refs: string[]): string {
  const logicalName = branchCompareLogicalName(ref);
  if (!logicalName) return '';
  if (isRemoteCompareRef(ref)) return ref;
  for (const remote of ['origin', 'upstream']) {
    const remoteRef = `${remote}/${logicalName}`;
    if (refs.includes(remoteRef)) return remoteRef;
  }
  return ref;
}

function isRemoteCompareRef(ref: string): boolean {
  return ref.startsWith('origin/') || ref.startsWith('upstream/');
}

function ReviewSummarySection({
  diffLayout,
  emptyText,
  fileExpansionRequest,
  focusRequest,
  lineWrap,
  pathContext,
  summary,
  workspaceApp,
  workspaceApps,
  onAddFileToConversation,
  onCopyFilePath,
  onExternalOpenFile,
  onOpenFileWithApp,
  onOpenProjectFile,
  onRevealFile,
}: {
  diffLayout: DesktopReviewDiffLayout;
  emptyText: { title: string; description: string };
  fileExpansionRequest: ReviewFileExpansionRequest;
  focusRequest?: DesktopReviewFocusRequest | null;
  lineWrap: boolean;
  pathContext: ReviewPathContext;
  summary: DesktopDiffSummary | null;
  workspaceApp?: DesktopWorkspaceApp | null;
  workspaceApps: DesktopWorkspaceApp[];
  onAddFileToConversation: (filePath: string) => void;
  onCopyFilePath: (filePath: string) => void;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenFileWithApp: (appId: string, filePath: string, line?: number) => void;
  onOpenProjectFile: (filePath: string) => void;
  onRevealFile: (filePath: string) => void;
}) {
  const files = summary?.files ?? [];
  return (
    <section className="desktop-review-section">
      {files.length ? (
        <div className="desktop-review-file-list">
          {files.map((file) => (
            <ReviewFileCard
              diffLayout={diffLayout}
              fileExpansionRequest={fileExpansionRequest}
              file={file}
              focusRequest={focusRequest}
              key={file.path}
              lineWrap={lineWrap}
              pathContext={pathContext}
              workspaceApp={workspaceApp}
              workspaceApps={workspaceApps}
              onAddFileToConversation={onAddFileToConversation}
              onCopyFilePath={onCopyFilePath}
              onExternalOpenFile={onExternalOpenFile}
              onOpenFileWithApp={onOpenFileWithApp}
              onOpenProjectFile={onOpenProjectFile}
              onRevealFile={onRevealFile}
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
  diffLayout,
  fileExpansionRequest,
  file,
  focusRequest,
  lineWrap,
  pathContext,
  workspaceApp,
  workspaceApps,
  onAddFileToConversation,
  onCopyFilePath,
  onExternalOpenFile,
  onOpenFileWithApp,
  onOpenProjectFile,
  onRevealFile,
}: {
  diffLayout: DesktopReviewDiffLayout;
  fileExpansionRequest: ReviewFileExpansionRequest;
  file: DesktopDiffFile;
  focusRequest?: DesktopReviewFocusRequest | null;
  lineWrap: boolean;
  pathContext: ReviewPathContext;
  workspaceApp?: DesktopWorkspaceApp | null;
  workspaceApps: DesktopWorkspaceApp[];
  onAddFileToConversation: (filePath: string) => void;
  onCopyFilePath: (filePath: string) => void;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenFileWithApp: (appId: string, filePath: string, line?: number) => void;
  onOpenProjectFile: (filePath: string) => void;
  onRevealFile: (filePath: string) => void;
}) {
  const [expanded, setExpanded] = useState(fileExpansionRequest.expanded);
  const [focusHighlightVersion, setFocusHighlightVersion] = useState<number | null>(null);
  const [lineContextMenu, setLineContextMenu] = useState<WorkspaceFileContextTarget | null>(null);
  const fileCardRef = useRef<HTMLElement | null>(null);
  const workspaceFilePath = reviewWorkspaceFilePath(file.path, pathContext);
  const canOpenFile = Boolean(workspaceFilePath);
  const focusedByRequest = Boolean(
    focusRequest
      && normalizeReviewFocusPath(file.path) === normalizeReviewFocusPath(focusRequest.path),
  );
  const visibleLines = file.lines;
  const language = fileLanguage(file.path);
  const wholeFileChange = useMemo(
    () => (expanded ? reviewWholeFileChangeType(visibleLines) : null),
    [expanded, visibleLines],
  );
  const splitWholeFileChange = diffLayout === 'split' ? wholeFileChange : null;
  const highlightedVisibleLines = useMemo<HighlightedReviewDiffLine[]>(
    () => {
      // 折叠文件应保持低开销：在大型审查中预先高亮每个隐藏文件会产生明显成本。
      if (!expanded) return [];
      const highlightedLines = highlightedReviewDiffLines(visibleLines, language);
      return visibleLines.map((line, index) => ({
        highlighted: highlightedLines[index],
        key: `${file.path}:${line.lineNumber}:${index}`,
        line,
      }));
    },
    [expanded, file.path, language, visibleLines],
  );
  const splitRows = useMemo(
    () => (expanded && diffLayout === 'split'
      ? splitReviewDiffRows(highlightedVisibleLines)
      : []),
    [diffLayout, expanded, highlightedVisibleLines],
  );
  const diffRowEstimate = useCallback((index: number) => diffLayout === 'split' && !splitWholeFileChange
    ? estimatedSplitDiffRowHeight(splitRows[index])
    : estimatedUnifiedDiffLineHeight(highlightedVisibleLines[index]), [diffLayout, highlightedVisibleLines, splitRows, splitWholeFileChange]);

  useEffect(() => {
    setExpanded(fileExpansionRequest.expanded);
  }, [fileExpansionRequest.expanded, fileExpansionRequest.version]);

  useEffect(() => {
    if (!focusedByRequest || focusRequest?.version === undefined) return undefined;
    setExpanded(true);
    setFocusHighlightVersion(focusRequest.version);
    const frame = window.requestAnimationFrame(() => {
      fileCardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const timer = window.setTimeout(() => {
      setFocusHighlightVersion((current) => (current === focusRequest.version ? null : current));
    }, 1400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusedByRequest, focusRequest?.version]);

  const openDiffLineContextMenu = (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => {
    if (!workspaceFilePath) return;
    event.preventDefault();
    event.stopPropagation();
    setLineContextMenu({
      filePath: workspaceFilePath,
      line: preferredLine ?? line.newLine ?? line.oldLine,
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <>
      <article
        className={[
          'desktop-review-file-card',
          expanded ? 'is-open' : '',
          focusHighlightVersion === focusRequest?.version ? 'is-focused' : '',
        ].filter(Boolean).join(' ')}
        ref={fileCardRef}
      >
        <header
          className="desktop-review-file-card__summary"
          onContextMenu={(event) => {
            if (!workspaceFilePath) return;
            event.preventDefault();
            setLineContextMenu({ filePath: workspaceFilePath, x: event.clientX, y: event.clientY });
          }}
        >
          <button
            className="desktop-review-file-card__path-main"
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? '折叠' : '展开'} ${file.path}，${file.action}`}
            onClick={() => setExpanded((value) => !value)}
          >
            <WorkspaceFileIcon path={file.path} type="file" />
            <ReviewFilePath path={file.path} />
            <ReviewChangeCounts additions={file.additions} deletions={file.deletions} />
          </button>
          <div className="desktop-review-file-card__meta">
            <IconButton
              disabled={!canOpenFile}
              label={canOpenFile ? 'Open file in panel' : '文件不在当前项目目录内'}
              variant="ghost"
              onClick={() => {
                if (workspaceFilePath) onOpenProjectFile(workspaceFilePath);
              }}
            >
              <PanelRightOpen size={13} />
            </IconButton>
            <IconButton
              disabled={!workspaceApp || !canOpenFile}
              label={!canOpenFile ? '文件不在当前项目目录内' : workspaceApp ? `Open in ${workspaceApp.label}` : '未检测到打开方式'}
              variant="ghost"
              onClick={() => {
                if (workspaceFilePath) onExternalOpenFile(workspaceFilePath);
              }}
            >
              <Code2 size={13} />
            </IconButton>
          </div>
        </header>
        {expanded && visibleLines.length ? (
          <ReviewDiffContent
            className={[
              'desktop-review-diff',
              `desktop-review-diff--${diffLayout}`,
              lineWrap ? 'desktop-review-diff--wrap' : '',
              splitWholeFileChange ? 'desktop-review-diff--single-sided' : '',
              splitWholeFileChange ? `desktop-review-diff--single-sided-${splitWholeFileChange}` : '',
            ].filter(Boolean).join(' ')}
            diffLayout={diffLayout}
            highlightedLines={highlightedVisibleLines}
            language={language}
            lineWrap={lineWrap}
            rowEstimate={diffRowEstimate}
            splitRows={splitRows}
            wholeFileChange={splitWholeFileChange}
            onLineContextMenu={openDiffLineContextMenu}
          >
            {file.truncated ? <div className="desktop-review-truncated">diff 过大，已截断展示。</div> : null}
          </ReviewDiffContent>
        ) : null}
      </article>
      <WorkspaceFileContextMenu
        selectedWorkspaceApp={workspaceApp ?? null}
        target={lineContextMenu}
        workspaceApps={workspaceApps}
        onAddToConversation={onAddFileToConversation}
        onClose={() => setLineContextMenu(null)}
        onCopyPath={onCopyFilePath}
        onOpenWithApp={onOpenFileWithApp}
        onReveal={onRevealFile}
      />
    </>
  );
}

function ReviewDiffContent({
  children,
  className,
  diffLayout,
  highlightedLines,
  language,
  lineWrap,
  rowEstimate,
  splitRows,
  wholeFileChange,
  onLineContextMenu,
}: {
  children?: ReactNode;
  className: string;
  diffLayout: DesktopReviewDiffLayout;
  highlightedLines: HighlightedReviewDiffLine[];
  language: string;
  lineWrap: boolean;
  rowEstimate: (index: number) => number;
  splitRows: SplitReviewDiffRow[];
  wholeFileChange: WholeFileReviewChange | null;
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  const isTwoSidedSplit = diffLayout === 'split' && !wholeFileChange;
  const itemCount = isTwoSidedSplit ? splitRows.length : highlightedLines.length;
  const shouldVirtualize = canVirtualizeReviewDiff(itemCount);
  const intrinsicSizeStyle = useMemo<CSSProperties | undefined>(() => {
    if (shouldVirtualize) return undefined;
    let estimatedHeight = 0;
    for (let index = 0; index < itemCount; index += 1) {
      estimatedHeight += rowEstimate(index);
    }
    return {
      '--desktop-review-diff-intrinsic-block-size': `${Math.max(REVIEW_DIFF_LINE_HEIGHT_PX, estimatedHeight)}px`,
    } as CSSProperties;
  }, [itemCount, rowEstimate, shouldVirtualize]);

  if (isTwoSidedSplit) {
    if (shouldVirtualize && !lineWrap) {
      return (
        <ReviewSplitVirtualDiffViewport
          className={className}
          language={language}
          rows={splitRows}
          rowEstimate={rowEstimate}
          onLineContextMenu={onLineContextMenu}
        >
          {children}
        </ReviewSplitVirtualDiffViewport>
      );
    }
    if (shouldVirtualize) {
      return (
        <VirtualReviewDiffViewport
          className={className}
          itemCount={itemCount}
          renderItem={(index) => (
            <ReviewSplitDiffRow
              language={language}
              lineWrap={lineWrap}
              row={splitRows[index]}
              onLineContextMenu={onLineContextMenu}
            />
          )}
          rowEstimate={rowEstimate}
          virtualizationKey={`split:${lineWrap ? 'wrap' : 'nowrap'}`}
        >
          {children}
        </VirtualReviewDiffViewport>
      );
    }
    return (
      <div className={className} style={intrinsicSizeStyle}>
        <ReviewSplitDiff
          language={language}
          lineWrap={lineWrap}
          rows={splitRows}
          onLineContextMenu={onLineContextMenu}
        />
        {children}
      </div>
    );
  }

  if (!shouldVirtualize) {
    return (
      <div className={className} style={intrinsicSizeStyle}>
        <ReviewUnifiedDiff
          language={language}
          lineWrap={lineWrap}
          lines={highlightedLines}
          onLineContextMenu={onLineContextMenu}
        />
        {children}
      </div>
    );
  }

  return (
    <VirtualReviewDiffViewport
      className={className}
      itemCount={itemCount}
      renderItem={(index) => (
        <ReviewUnifiedDiffLine
          item={highlightedLines[index]}
          language={language}
          lineWrap={lineWrap}
          onLineContextMenu={onLineContextMenu}
        />
      )}
      rowEstimate={rowEstimate}
      virtualizationKey={`${diffLayout}:${wholeFileChange ?? 'unified'}:${lineWrap ? 'wrap' : 'nowrap'}`}
    >
      {children}
    </VirtualReviewDiffViewport>
  );
}

function ReviewSplitVirtualDiffViewport({
  children,
  className,
  language,
  rows,
  rowEstimate,
  onLineContextMenu,
}: {
  children?: ReactNode;
  className: string;
  language: string;
  rows: SplitReviewDiffRow[];
  rowEstimate: (index: number) => number;
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  const oldPaneRef = useRef<HTMLDivElement | null>(null);
  const newPaneRef = useRef<HTMLDivElement | null>(null);
  const splitMeasuredHeightsRef = useRef<Map<number, { new?: number; old?: number }>>(new Map());
  const previousRowsRef = useRef(rows);
  if (previousRowsRef.current !== rows) {
    previousRowsRef.current = rows;
    splitMeasuredHeightsRef.current.clear();
  }
  const {
    measureItem,
    onScroll,
    setVirtualScrollTop,
    setViewportElement,
    totalHeight,
    virtualItems,
  } = useReviewDiffVirtualizer({ itemCount: rows.length, rowEstimate });
  const measureSplitItem = useCallback((side: 'new' | 'old', index: number, height: number) => {
    const previous = splitMeasuredHeightsRef.current.get(index) ?? {};
    const next = { ...previous, [side]: height };
    splitMeasuredHeightsRef.current.set(index, next);
    measureItem(index, Math.max(next.old ?? 0, next.new ?? 0));
  }, [measureItem]);
  const measureOldItem = useCallback((index: number, height: number) => {
    measureSplitItem('old', index, height);
  }, [measureSplitItem]);
  const measureNewItem = useCallback((index: number, height: number) => {
    measureSplitItem('new', index, height);
  }, [measureSplitItem]);
  const syncPaneScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    const targetPane = event.currentTarget === oldPaneRef.current ? newPaneRef.current : oldPaneRef.current;
    if (targetPane && Math.abs(targetPane.scrollTop - nextScrollTop) > 1) targetPane.scrollTop = nextScrollTop;
    onScroll(event);
  }, [onScroll]);
  const scrollOldPaneVertically = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.deltaY || !newPaneRef.current) return;
    event.preventDefault();
    const pane = newPaneRef.current;
    const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, pane.scrollTop + event.deltaY));
    pane.scrollTop = nextScrollTop;
    if (oldPaneRef.current) oldPaneRef.current.scrollTop = nextScrollTop;
    setVirtualScrollTop(nextScrollTop);
  }, [setVirtualScrollTop]);

  useEffect(() => {
    if (oldPaneRef.current) oldPaneRef.current.scrollTop = 0;
    if (newPaneRef.current) newPaneRef.current.scrollTop = 0;
  }, [rows]);

  return (
    <div
      className={`${className} desktop-review-diff--virtual desktop-review-diff--split-independent`}
      style={{ height: REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX }}
    >
      <div
        className="desktop-review-diff-split-virtual-pane desktop-review-diff-split-virtual-pane--old"
        ref={oldPaneRef}
        onScroll={syncPaneScroll}
        onWheel={scrollOldPaneVertically}
      >
        <div className="desktop-review-diff-virtual-spacer" style={{ height: totalHeight }}>
          <ReviewVirtualStack top={virtualItems[0]?.top ?? 0}>
            {virtualItems.map((item) => (
              <ReviewVirtualStackRow
                index={item.index}
                key={item.index}
                minHeight={item.height}
                onMeasure={measureOldItem}
              >
                <ReviewSplitDiffCell
                  item={rows[item.index]?.oldLine ?? null}
                  language={language}
                  lineWrap={false}
                  side="old"
                  onLineContextMenu={onLineContextMenu}
                />
              </ReviewVirtualStackRow>
            ))}
          </ReviewVirtualStack>
        </div>
      </div>
      <div
        className="desktop-review-diff-split-virtual-pane desktop-review-diff-split-virtual-pane--new"
        ref={(element) => {
          newPaneRef.current = element;
          setViewportElement(element);
        }}
        onScroll={syncPaneScroll}
      >
        <div className="desktop-review-diff-virtual-spacer" style={{ height: totalHeight }}>
          <ReviewVirtualStack top={virtualItems[0]?.top ?? 0}>
            {virtualItems.map((item) => (
              <ReviewVirtualStackRow
                index={item.index}
                key={item.index}
                minHeight={item.height}
                onMeasure={measureNewItem}
              >
                <ReviewSplitDiffCell
                  item={rows[item.index]?.newLine ?? null}
                  language={language}
                  lineWrap={false}
                  side="new"
                  onLineContextMenu={onLineContextMenu}
                />
              </ReviewVirtualStackRow>
            ))}
          </ReviewVirtualStack>
        </div>
      </div>
      {children}
    </div>
  );
}

function VirtualReviewDiffViewport({
  children,
  className,
  itemCount,
  renderItem,
  rowEstimate,
  virtualizationKey,
}: {
  children?: ReactNode;
  className: string;
  itemCount: number;
  renderItem: (index: number) => ReactNode;
  rowEstimate: (index: number) => number;
  virtualizationKey: string;
}) {
  const {
    containerRef,
    measureItem,
    onScroll,
    totalHeight,
    virtualItems,
  } = useReviewDiffVirtualizer({ itemCount, rowEstimate, virtualizationKey });

  return (
    <div
      className={`${className} desktop-review-diff--virtual`}
      ref={containerRef}
      style={{ height: REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX }}
      onScroll={onScroll}
    >
      <div className="desktop-review-diff-virtual-spacer" style={{ height: totalHeight }}>
        <ReviewVirtualStack top={virtualItems[0]?.top ?? 0}>
          {virtualItems.map((item) => (
            <ReviewVirtualStackRow
              index={item.index}
              key={item.index}
              minHeight={item.height}
              onMeasure={measureItem}
            >
              {renderItem(item.index)}
            </ReviewVirtualStackRow>
          ))}
        </ReviewVirtualStack>
      </div>
      {children}
    </div>
  );
}

function ReviewVirtualStack({ children, top }: { children: ReactNode; top: number }) {
  return (
    <div
      className="desktop-review-diff-virtual-stack"
      style={{ transform: `translateY(${top}px)` }}
    >
      {children}
    </div>
  );
}

function ReviewVirtualStackRow({
  children,
  index,
  minHeight,
  onMeasure,
}: {
  children: ReactNode;
  index: number;
  minHeight: number;
  onMeasure: (index: number, height: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useReviewLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    // 测量内容的固有高度，而不是包装元素预留的最小高度。测量包装元素会把临时的
    // 过大数值不断反馈给自身。
    const content = row.firstElementChild ?? row;
    const measure = () => onMeasure(index, content.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [index, onMeasure]);

  return (
    <div
      className="desktop-review-diff-virtual-stack-row"
      ref={rowRef}
      style={{ minHeight }}
    >
      {children}
    </div>
  );
}

function ReviewUnifiedDiff({
  language,
  lineWrap,
  lines,
  onLineContextMenu,
}: {
  language: string;
  lineWrap: boolean;
  lines: HighlightedReviewDiffLine[];
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  return (
    <>
      {lines.map((item) => (
        <ReviewUnifiedDiffLine
          item={item}
          key={item.key}
          language={language}
          lineWrap={lineWrap}
          onLineContextMenu={onLineContextMenu}
        />
      ))}
    </>
  );
}

function ReviewUnifiedDiffLine({
  item,
  language,
  lineWrap,
  onLineContextMenu,
}: {
  item: HighlightedReviewDiffLine;
  language: string;
  lineWrap: boolean;
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  if (item.line.type === 'gap') {
    return (
      <div className={`desktop-review-diff-line desktop-review-diff-line--gap ${lineWrap ? 'desktop-review-diff-line--wrap' : ''}`}>
        <ReviewDiffGapContent content={item.line.content} />
      </div>
    );
  }
  const targetLine = item.line.newLine ?? item.line.oldLine;
  return (
    <div
      className={`desktop-review-diff-line desktop-review-diff-line--${item.line.type} ${lineWrap ? 'desktop-review-diff-line--wrap' : ''}`}
      onContextMenu={(event) => onLineContextMenu(event, item.line, targetLine)}
    >
      <span className="desktop-review-diff-line__number">{targetLine ?? ''}</span>
      <ReviewDiffCode content={item.line.content} highlighted={item.highlighted} language={language} lineWrap={lineWrap} />
    </div>
  );
}

function ReviewSplitDiff({
  language,
  lineWrap,
  rows,
  onLineContextMenu,
}: {
  language: string;
  lineWrap: boolean;
  rows: SplitReviewDiffRow[];
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  if (!lineWrap) {
    return (
      <>
        <div className="desktop-review-diff-split-pane desktop-review-diff-split-pane--old">
          {rows.map((row) => (
            <ReviewSplitDiffCell
              item={row.oldLine}
              key={`${row.key}:old`}
              language={language}
              lineWrap={false}
              side="old"
              onLineContextMenu={onLineContextMenu}
            />
          ))}
        </div>
        <div className="desktop-review-diff-split-pane desktop-review-diff-split-pane--new">
          {rows.map((row) => (
            <ReviewSplitDiffCell
              item={row.newLine}
              key={`${row.key}:new`}
              language={language}
              lineWrap={false}
              side="new"
              onLineContextMenu={onLineContextMenu}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <ReviewSplitDiffRow
          key={row.key}
          language={language}
          lineWrap={lineWrap}
          row={row}
          onLineContextMenu={onLineContextMenu}
        />
      ))}
    </>
  );
}

function ReviewSplitDiffRow({
  language,
  lineWrap,
  row,
  onLineContextMenu,
}: {
  language: string;
  lineWrap: boolean;
  row: SplitReviewDiffRow;
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  const isGapRow = row.oldLine?.line.type === 'gap' && !row.newLine;
  return (
    <div className={`desktop-review-diff-split-row ${isGapRow ? 'desktop-review-diff-split-row--gap' : ''}`}>
      <ReviewSplitDiffCell
        item={row.oldLine}
        language={language}
        lineWrap={lineWrap}
        side="old"
        onLineContextMenu={onLineContextMenu}
      />
      {isGapRow ? null : (
        <ReviewSplitDiffCell
          item={row.newLine}
          language={language}
          lineWrap={lineWrap}
          side="new"
          onLineContextMenu={onLineContextMenu}
        />
      )}
    </div>
  );
}

function ReviewSplitDiffCell({
  item,
  language,
  lineWrap,
  side,
  onLineContextMenu,
}: {
  item: HighlightedReviewDiffLine | null;
  language: string;
  lineWrap: boolean;
  side: 'old' | 'new';
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  if (!item) {
    return <span aria-hidden="true" className={`desktop-review-diff-split-cell desktop-review-diff-split-cell--${side} desktop-review-diff-split-cell--empty ${lineWrap ? 'desktop-review-diff-split-cell--wrap' : ''}`} />;
  }
  if (item.line.type === 'gap') {
    return (
      <span className={`desktop-review-diff-split-cell desktop-review-diff-split-cell--${side} desktop-review-diff-split-cell--gap ${lineWrap ? 'desktop-review-diff-split-cell--wrap' : ''}`}>
        <ReviewDiffGapContent content={item.line.content} />
      </span>
    );
  }
  const targetLine = side === 'old' ? item.line.oldLine ?? item.line.newLine : item.line.newLine ?? item.line.oldLine;
  return (
    <div
      className={`desktop-review-diff-split-cell desktop-review-diff-split-cell--${side} desktop-review-diff-split-cell--${item.line.type} ${lineWrap ? 'desktop-review-diff-split-cell--wrap' : ''}`}
      onContextMenu={(event) => onLineContextMenu(event, item.line, targetLine)}
    >
      <span className="desktop-review-diff-line__number">{targetLine ?? ''}</span>
      <ReviewDiffCode content={item.line.content} highlighted={item.highlighted} language={language} lineWrap={lineWrap} />
    </div>
  );
}

function ReviewDiffGapContent({ content }: { content: string }) {
  return (
    <span className="desktop-review-diff-gap-content">
      <span aria-hidden="true" className="desktop-review-diff-line__number desktop-review-diff-gap-content__gutter">
        <ChevronsUpDown size={11} />
      </span>
      <span className="desktop-review-diff-gap-content__label">{content}</span>
    </span>
  );
}

export function highlightedReviewDiffLines(lines: DesktopDiffFile['lines'], language: string): Array<string | undefined> {
  const highlightedLines = Array<string | undefined>(lines.length).fill(undefined);
  let segmentStart = 0;

  for (let index = 0; index <= lines.length; index += 1) {
    if (index < lines.length && lines[index]?.type !== 'gap') continue;
    highlightReviewDiffSegment(lines, segmentStart, index, language, highlightedLines);
    segmentStart = index + 1;
  }

  return highlightedLines;
}

export function reviewWholeFileChangeType(lines: DesktopDiffFile['lines']): WholeFileReviewChange | null {
  const contentLines = lines.filter((line) => line.type !== 'gap');
  if (!contentLines.length) return null;
  if (contentLines.every((line) => line.type === 'added')) return 'added';
  if (contentLines.every((line) => line.type === 'removed')) return 'removed';
  return null;
}

function highlightReviewDiffSegment(
  lines: DesktopDiffFile['lines'],
  start: number,
  end: number,
  language: string,
  output: Array<string | undefined>,
): void {
  if (start >= end) return;
  const oldSourceLines: Array<{ content: string; index: number }> = [];
  const newSourceLines: Array<{ content: string; index: number }> = [];

  // 分别将新旧两侧解析为连续源码，既保留多行语法上下文，又不会混合变更块的两个版本。
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (!line || line.type === 'gap') continue;
    if (line.type !== 'added') oldSourceLines.push({ content: line.content, index });
    if (line.type !== 'removed') newSourceLines.push({ content: line.content, index });
  }

  const oldHighlightedLines = highlightedCodeLinesHtml(oldSourceLines.map((line) => line.content).join('\n'), language);
  oldSourceLines.forEach((line, index) => {
    if (lines[line.index]?.type === 'removed') output[line.index] = oldHighlightedLines[index];
  });

  const newHighlightedLines = highlightedCodeLinesHtml(newSourceLines.map((line) => line.content).join('\n'), language);
  newSourceLines.forEach((line, index) => {
    output[line.index] = newHighlightedLines[index];
  });
}

function ReviewDiffCode({ content, highlighted, language, lineWrap }: { content: string; highlighted?: string; language: string; lineWrap: boolean }) {
  const shouldWrap = shouldWrapReviewDiffLine(content, lineWrap);
  const className = [
    'desktop-review-diff-code',
    shouldWrap ? 'desktop-review-diff-code--wrap' : '',
    lineWrap && !shouldWrap ? 'desktop-review-diff-code--long-line' : '',
  ].filter(Boolean).join(' ');
  if (highlighted !== undefined) {
    return <code className={`${className} language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />;
  }
  return <code className={className}>{content || ' '}</code>;
}

export function shouldWrapReviewDiffLine(content: string, lineWrap: boolean): boolean {
  return lineWrap && content.length <= REVIEW_DIFF_MAX_WRAPPABLE_LINE_CHARS;
}

function splitReviewDiffRows(lines: HighlightedReviewDiffLine[]): SplitReviewDiffRow[] {
  const rows: SplitReviewDiffRow[] = [];
  let removedLines: HighlightedReviewDiffLine[] = [];
  let addedLines: HighlightedReviewDiffLine[] = [];
  const flushChangedLines = () => {
    const rowCount = Math.max(removedLines.length, addedLines.length);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        key: `change:${rows.length}:${removedLines[index]?.key ?? ''}:${addedLines[index]?.key ?? ''}`,
        oldLine: removedLines[index] ?? null,
        newLine: addedLines[index] ?? null,
      });
    }
    removedLines = [];
    addedLines = [];
  };

  for (const line of lines) {
    if (line.line.type === 'removed') {
      removedLines.push(line);
      continue;
    }
    if (line.line.type === 'added') {
      addedLines.push(line);
      continue;
    }
    flushChangedLines();
    rows.push({
      key: `${line.line.type}:${line.key}`,
      oldLine: line,
      newLine: line.line.type === 'gap' ? null : line,
    });
  }
  flushChangedLines();
  return rows;
}

type ReviewVirtualItem = {
  height: number;
  index: number;
  top: number;
};

function useReviewDiffVirtualizer({
  itemCount,
  rowEstimate,
  virtualizationKey = 'default',
}: {
  itemCount: number;
  rowEstimate: (index: number) => number;
  virtualizationKey?: string;
}): {
  containerRef: (element: HTMLDivElement | null) => void;
  measureItem: (index: number, height: number) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  setVirtualScrollTop: (scrollTop: number) => void;
  setViewportElement: (element: HTMLDivElement | null) => void;
  totalHeight: number;
  virtualItems: ReviewVirtualItem[];
} {
  const containerElementRef = useRef<HTMLDivElement | null>(null);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportElement, setViewportElementState] = useState<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const setViewportElement = useCallback((element: HTMLDivElement | null) => {
    containerElementRef.current = element;
    setViewportElementState(element);
  }, []);

  useEffect(() => {
    measuredHeightsRef.current = new Map();
    setMeasuredVersion((version) => version + 1);
    setScrollTop(0);
    if (containerElementRef.current) containerElementRef.current.scrollTop = 0;
  }, [itemCount, rowEstimate, virtualizationKey]);

  useReviewLayoutEffect(() => {
    const container = viewportElement;
    if (!container) return undefined;
    const updateViewportSize = () => {
      const nextHeight = container.clientHeight;
      const nextWidth = container.clientWidth;
      setViewportHeight(nextHeight);
      setViewportWidth((previousWidth) => {
        if (previousWidth === nextWidth) return previousWidth;
        measuredHeightsRef.current = new Map();
        setMeasuredVersion((version) => version + 1);
        return nextWidth;
      });
    };
    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [viewportElement]);

  const offsets = useMemo(() => {
    const nextOffsets = new Array<number>(itemCount + 1);
    nextOffsets[0] = 0;
    for (let index = 0; index < itemCount; index += 1) {
      const measuredHeight = measuredHeightsRef.current.get(index);
      nextOffsets[index + 1] = nextOffsets[index] + (measuredHeight ?? rowEstimate(index));
    }
    return nextOffsets;
  }, [itemCount, measuredVersion, rowEstimate]);

  const visibleRange = useMemo(
    () => reviewVirtualRange(offsets, scrollTop, viewportHeight),
    [offsets, scrollTop, viewportHeight, viewportWidth],
  );

  const virtualItems = useMemo(() => {
    const items: ReviewVirtualItem[] = [];
    for (let index = visibleRange.start; index < visibleRange.end; index += 1) {
      const top = offsets[index] ?? 0;
      items.push({ height: Math.max(REVIEW_DIFF_LINE_HEIGHT_PX, (offsets[index + 1] ?? top) - top), index, top });
    }
    return items;
  }, [offsets, visibleRange.end, visibleRange.start]);

  const measureItem = useCallback((index: number, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const roundedHeight = Math.ceil(height);
    const previousHeight = measuredHeightsRef.current.get(index);
    if (previousHeight === roundedHeight) return;
    measuredHeightsRef.current.set(index, roundedHeight);
    setMeasuredVersion((version) => version + 1);
  }, []);

  const setVirtualScrollTop = useCallback((nextScrollTop: number) => {
    setScrollTop(nextScrollTop);
  }, []);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setVirtualScrollTop(event.currentTarget.scrollTop);
  }, [setVirtualScrollTop]);

  return {
    containerRef: setViewportElement,
    measureItem,
    onScroll,
    setVirtualScrollTop,
    setViewportElement,
    totalHeight: offsets[itemCount] ?? 0,
    virtualItems,
  };
}

export function reviewVirtualRange(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number = REVIEW_DIFF_ROW_OVERSCAN,
): { end: number; start: number } {
  const itemCount = Math.max(0, offsets.length - 1);
  if (!itemCount) return { start: 0, end: 0 };
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(REVIEW_DIFF_LINE_HEIGHT_PX, viewportHeight);
  const start = Math.max(0, offsetIndexForPosition(offsets, safeScrollTop) - overscan);
  const end = Math.min(itemCount, offsetIndexForPosition(offsets, safeScrollTop + safeViewportHeight) + overscan + 1);
  return { start, end: Math.max(start, end) };
}

function offsetIndexForPosition(offsets: number[], position: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if ((offsets[middle + 1] ?? 0) <= position) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function canVirtualizeReviewDiff(itemCount: number): boolean {
  return itemCount > REVIEW_DIFF_VIRTUALIZE_THRESHOLD
    && typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && typeof ResizeObserver !== 'undefined';
}

function estimatedUnifiedDiffLineHeight(item?: HighlightedReviewDiffLine | null): number {
  return item?.line.type === 'gap' ? REVIEW_DIFF_GAP_HEIGHT_PX : REVIEW_DIFF_LINE_HEIGHT_PX;
}

function estimatedSplitDiffRowHeight(row?: SplitReviewDiffRow | null): number {
  const oldHeight = estimatedUnifiedDiffLineHeight(row?.oldLine);
  const newHeight = estimatedUnifiedDiffLineHeight(row?.newLine);
  return Math.max(oldHeight, newHeight);
}
