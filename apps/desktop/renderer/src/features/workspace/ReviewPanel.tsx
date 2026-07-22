import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button, Dropdown, type MenuProps } from 'antd';
import {
  AlignJustify,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  GitBranch,
  RefreshCw,
  Rows3,
  Search,
  WrapText,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionTooltip, EmptyState, IconButton } from '../../shared/ui/primitives.js';
import type {
  DesktopDiffSummary,
  DesktopReviewFocusRequest,
  DesktopReviewLoadOptions,
  DesktopReviewState,
  DesktopWorkspaceApp,
} from './model.js';
import { normalizeReviewFocusPath } from './review-paths.js';
import type {
  BranchCompareRefOption,
  DesktopReviewDiffLayout,
  DesktopReviewSource,
  ReviewFileExpansionRequest,
  ReviewPathContext,
} from './review-types.js';
import { ReviewChangeCounts } from './ReviewChangeCounts.js';
import { canCompareReviewBranch } from './reviewChanges.js';
import { ReviewSummarySection } from './ReviewDiffView.js';

export type { BranchCompareRefOption, DesktopReviewSource, ReviewPathContext } from './review-types.js';
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
const DEFAULT_REVIEW_LINE_WRAP = true;
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

export { reviewFilePathParts, reviewWorkspaceFilePath } from './review-paths.js';
export {
  highlightedReviewDiffLines,
  reviewVirtualRange,
  reviewWholeFileChangeType,
  shouldWrapReviewDiffLine
} from './ReviewDiffView.js';
