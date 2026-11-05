import { FileTreeSurface, FileTreeRow, ResizeHandle, TextField } from '@setsuna-desktop/renderer-ui';

import {
  List,
  ListTree,
  Search,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { DesktopDiffFile } from '../contracts/index.js';
import { useReviewRendererHost } from './host.js';
import { readReviewPreference, writeReviewPreference } from './preferences.js';
import {
  ReviewActionTooltip as ActionTooltip,
  ReviewIconButton as IconButton,
} from './primitives.js';
import { ReviewChangeCounts } from './ReviewChangeCounts.js';
import { ReviewFileIcon } from './ReviewFileVisuals.js';
import { buildReviewFileTree, type ReviewFileTreeNode as FileTreeNode } from './model/reviewFileTree.js';

const REVIEW_FILE_TREE_DEFAULT_WIDTH = 248;
const REVIEW_FILE_TREE_MIN_WIDTH = 190;
const REVIEW_FILE_TREE_MAX_WIDTH = 360;
const REVIEW_FILE_TREE_LAYOUT_STORAGE_KEY = 'setsuna-desktop:review-file-browser-layout';
const REVIEW_FILE_TREE_WIDTH_STORAGE_KEY = 'setsuna-desktop:review-file-browser-width';

type ReviewFileListLayout = 'flat' | 'tree';
type ReviewFileTreeNode = FileTreeNode<DesktopDiffFile>;

/**
 * Directory state stays below ReviewFileBrowser so filtering, folding and
 * pixel-by-pixel resizing never rerender the mounted syntax-highlighted diff.
 */
export const ReviewFileNavigator = memo(function ReviewFileNavigator({
  files,
  selectedPath,
  visible,
  onSelect,
}: {
  files: DesktopDiffFile[];
  selectedPath: string | null;
  visible: boolean;
  onSelect: (filePath: string) => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const [query, setQuery] = useState('');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [layout, setLayout] = useState<ReviewFileListLayout>(readReviewFileListLayout);
  const [width, setWidth] = useState(readReviewFileTreeWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleFiles = useMemo(() => (
    normalizedQuery
      ? files.filter((file) => file.path.toLocaleLowerCase().includes(normalizedQuery))
      : files
  ), [files, normalizedQuery]);
  const tree = useMemo(
    () => (layout === 'tree' ? buildReviewFileTree(visibleFiles) : []),
    [layout, visibleFiles],
  );
  // The slot owns sidebar motion; tree rows only animate when their contents change.
  const treeLayoutDependency = useMemo(
    () => [visibleFiles, collapsedPaths, layout],
    [visibleFiles, collapsedPaths, layout],
  );

  useEffect(() => () => resizeCleanupRef.current?.(), []);
  useEffect(() => {
    if (!visible) resizeCleanupRef.current?.();
  }, [visible]);

  const toggleDirectory = useCallback((directoryPath: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) next.delete(directoryPath);
      else next.add(directoryPath);
      return next;
    });
  }, []);
  const toggleLayout = useCallback(() => {
    setLayout((current) => {
      const next = current === 'tree' ? 'flat' : 'tree';
      writeReviewPreference(REVIEW_FILE_TREE_LAYOUT_STORAGE_KEY, next);
      return next;
    });
  }, []);
  const adjustWidth = useCallback((delta: number) => {
    setWidth((current) => {
      const next = clampReviewFileTreeWidth(current + delta);
      writeReviewPreference(REVIEW_FILE_TREE_WIDTH_STORAGE_KEY, String(next));
      return next;
    });
  }, []);
  const startResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let nextWidth = startWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampReviewFileTreeWidth(startWidth + startX - moveEvent.clientX);
      setWidth(nextWidth);
    };
    const stopResize = () => {
      document.body.classList.remove('desktop-review-file-tree-resizing');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      if (resizeCleanupRef.current === stopResize) resizeCleanupRef.current = null;
      writeReviewPreference(REVIEW_FILE_TREE_WIDTH_STORAGE_KEY, String(nextWidth));
    };
    resizeCleanupRef.current = stopResize;
    document.body.classList.add('desktop-review-file-tree-resizing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  }, [width]);

  const renderFileRow = (file: DesktopDiffFile, label: string, depth: number): JSX.Element => {
    const selected = file.path === selectedPath;
    return (
      <div className="desktop-review-file-tree__node" key={`file:${file.path}`}>
        <FileTreeRow
          depth={depth}
          selected={selected}
          label={label}
          icon={<ReviewFileIcon path={file.path} />}
          extra={<ReviewChangeCounts additions={file.additions} deletions={file.deletions} />}
          aria-label={file.path}
          className="desktop-review-file-tree__row"
          title={file.path}
          type="button"
          onClick={() => onSelect(file.path)}
        />
      </div>
    );
  };

  const renderNode = (node: ReviewFileTreeNode, depth = 0): JSX.Element => {
    if (node.type === 'file') return renderFileRow(node.file, node.name, depth);
    const expanded = Boolean(normalizedQuery) || !collapsedPaths.has(node.path);
    return (
      <div className="desktop-review-file-tree__node" key={`directory:${node.path}`}>
        <FileTreeRow
          depth={depth}
          expanded={expanded}
          label={node.name}
          className="desktop-review-file-tree__row"
          title={node.path}
          type="button"
          onClick={() => toggleDirectory(node.path)}
        />
        {expanded ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  const layoutToggleLabel = layout === 'tree'
    ? t('feature.review.workspace.fileBrowser.showFlat')
    : t('feature.review.workspace.fileBrowser.showTree');
  const rows = layout === 'tree'
    ? tree.map((node) => renderNode(node))
    : visibleFiles.map((file) => renderFileRow(file, file.path, 0));
  const navigatorStyle = {
    '--desktop-review-file-tree-width': `${width}px`,
    '--desktop-review-file-tree-track-width': `${visible ? width : 0}px`,
  } as CSSProperties;

  return (
    <div
      className="desktop-review-file-tree-slot"
      aria-hidden={!visible || undefined}
      {...(!visible ? { inert: '' } : {})}
      style={navigatorStyle}
    >
      <aside aria-label={t('feature.review.workspace.fileBrowser.label')} className="desktop-review-file-tree">
        <ResizeHandle
          aria-label={t('feature.review.workspace.fileBrowser.resize')}
          aria-orientation="vertical"
          aria-valuemax={REVIEW_FILE_TREE_MAX_WIDTH}
          aria-valuemin={REVIEW_FILE_TREE_MIN_WIDTH}
          aria-valuenow={width}
          className="desktop-review-file-tree__resize-handle"
          role="separator"
          title={t('feature.review.workspace.fileBrowser.resizeHint')}
          type="button"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              adjustWidth(16);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              adjustWidth(-16);
            } else if (event.key === 'Home') {
              event.preventDefault();
              adjustWidth(REVIEW_FILE_TREE_MIN_WIDTH - width);
            } else if (event.key === 'End') {
              event.preventDefault();
              adjustWidth(REVIEW_FILE_TREE_MAX_WIDTH - width);
            }
          }}
          onPointerDown={startResize}
        />
        <div className="desktop-review-file-tree__toolbar">
          <TextField
            appearance="search"
            leadingIcon={<Search size={13} />}
            aria-label={t('feature.review.workspace.fileBrowser.filter')}
            placeholder={t('feature.review.workspace.fileBrowser.filter')}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ActionTooltip title={layoutToggleLabel}>
            <IconButton
              aria-pressed={layout === 'flat'}
              className="desktop-review-file-tree__layout-toggle"
              label={layoutToggleLabel}
              title=""
              variant="ghost"
              onClick={toggleLayout}
            >
              {layout === 'tree' ? <List size={14} /> : <ListTree size={14} />}
            </IconButton>
          </ActionTooltip>
        </div>
        <FileTreeSurface className="desktop-review-file-tree__items" layoutDependency={treeLayoutDependency}>
          {rows.length ? rows : (
            <div className="desktop-review-file-tree__empty">
              {t('feature.review.workspace.fileBrowser.noMatch')}
            </div>
          )}
        </FileTreeSurface>
      </aside>
    </div>
  );
});

function clampReviewFileTreeWidth(width: number): number {
  return Math.min(
    REVIEW_FILE_TREE_MAX_WIDTH,
    Math.max(REVIEW_FILE_TREE_MIN_WIDTH, Math.round(width)),
  );
}

function readReviewFileListLayout(): ReviewFileListLayout {
  return readReviewPreference(REVIEW_FILE_TREE_LAYOUT_STORAGE_KEY) === 'flat'
    ? 'flat'
    : 'tree';
}

function readReviewFileTreeWidth(): number {
  const storedWidth = readReviewPreference(REVIEW_FILE_TREE_WIDTH_STORAGE_KEY);
  if (storedWidth === null) return REVIEW_FILE_TREE_DEFAULT_WIDTH;
  const parsedWidth = Number(storedWidth);
  return Number.isFinite(parsedWidth)
    ? clampReviewFileTreeWidth(parsedWidth)
    : REVIEW_FILE_TREE_DEFAULT_WIDTH;
}
