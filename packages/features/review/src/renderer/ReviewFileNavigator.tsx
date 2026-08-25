import {
  ChevronRight,
  Folder,
  List,
  ListTree,
  PanelRightClose,
  PanelRightOpen,
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

const reviewFilePathCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});
const REVIEW_FILE_TREE_DEFAULT_WIDTH = 248;
const REVIEW_FILE_TREE_MIN_WIDTH = 190;
const REVIEW_FILE_TREE_MAX_WIDTH = 360;
const REVIEW_FILE_TREE_COLLAPSED_WIDTH = 34;
const REVIEW_FILE_TREE_LAYOUT_STORAGE_KEY = 'setsuna-desktop:review-file-browser-layout';
const REVIEW_FILE_TREE_VISIBLE_STORAGE_KEY = 'setsuna-desktop:review-file-browser-visible';
const REVIEW_FILE_TREE_WIDTH_STORAGE_KEY = 'setsuna-desktop:review-file-browser-width';

type ReviewFileListLayout = 'flat' | 'tree';
type ReviewFileTreeNode = ReviewFileDirectoryNode | ReviewFileLeafNode;
type ReviewFileDirectoryNode = {
  children: ReviewFileTreeNode[];
  name: string;
  path: string;
  type: 'directory';
};
type ReviewFileLeafNode = {
  file: DesktopDiffFile;
  name: string;
  path: string;
  type: 'file';
};

/**
 * Navigation state stays below ReviewFileBrowser so filtering, collapsing and
 * pixel-by-pixel resizing never rerender the mounted syntax-highlighted diff.
 */
export const ReviewFileNavigator = memo(function ReviewFileNavigator({
  files,
  selectedPath,
  onSelect,
}: {
  files: DesktopDiffFile[];
  selectedPath: string | null;
  onSelect: (filePath: string) => void;
}) {
  const { translate: t } = useReviewRendererHost();
  const [query, setQuery] = useState('');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [layout, setLayout] = useState<ReviewFileListLayout>(readReviewFileListLayout);
  const [visible, setVisible] = useState(readReviewFileTreeVisible);
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

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const toggleDirectory = useCallback((directoryPath: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) next.delete(directoryPath);
      else next.add(directoryPath);
      return next;
    });
  }, []);
  const toggleVisible = useCallback(() => {
    setVisible((current) => {
      const next = !current;
      writeReviewPreference(REVIEW_FILE_TREE_VISIBLE_STORAGE_KEY, String(next));
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
    const rowStyle = {
      '--desktop-review-tree-indent': `${depth * 14}px`,
    } as CSSProperties;
    return (
      <div className="desktop-review-file-tree__node" key={`file:${file.path}`}>
        <button
          aria-current={selected ? 'true' : undefined}
          aria-label={file.path}
          className={`desktop-review-file-tree__row is-file${selected ? ' is-selected' : ''}`}
          style={rowStyle}
          title={file.path}
          type="button"
          onClick={() => onSelect(file.path)}
        >
          <span className="desktop-review-file-tree__spacer" />
          <ReviewFileIcon path={file.path} />
          <span>{label}</span>
          <ReviewChangeCounts additions={file.additions} deletions={file.deletions} />
        </button>
      </div>
    );
  };

  const renderNode = (node: ReviewFileTreeNode, depth = 0): JSX.Element => {
    if (node.type === 'file') return renderFileRow(node.file, node.name, depth);
    const expanded = Boolean(normalizedQuery) || !collapsedPaths.has(node.path);
    const rowStyle = {
      '--desktop-review-tree-indent': `${depth * 14}px`,
    } as CSSProperties;
    return (
      <div className="desktop-review-file-tree__node" key={`directory:${node.path}`}>
        <button
          aria-expanded={expanded}
          className="desktop-review-file-tree__row is-directory"
          style={rowStyle}
          title={node.path}
          type="button"
          onClick={() => toggleDirectory(node.path)}
        >
          <ChevronRight className={expanded ? 'is-expanded' : ''} size={13} />
          <Folder size={14} />
          <span>{node.name}</span>
        </button>
        {expanded ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };

  const layoutToggleLabel = layout === 'tree'
    ? t('feature.review.workspace.fileBrowser.showFlat')
    : t('feature.review.workspace.fileBrowser.showTree');
  const visibilityToggleLabel = visible
    ? t('feature.review.workspace.fileBrowser.collapse')
    : t('feature.review.workspace.fileBrowser.expand');
  const rows = !visible
    ? []
    : layout === 'tree'
      ? tree.map((node) => renderNode(node))
      : visibleFiles.map((file) => renderFileRow(file, file.path, 0));
  const navigatorStyle = {
    '--desktop-review-file-tree-width': `${
      visible ? width : REVIEW_FILE_TREE_COLLAPSED_WIDTH
    }px`,
  } as CSSProperties;

  return (
    <aside
      aria-label={t('feature.review.workspace.fileBrowser.label')}
      className={`desktop-review-file-tree${visible ? '' : ' is-collapsed'}`}
      style={navigatorStyle}
    >
      {visible ? (
        <button
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
      ) : null}
      <header className="desktop-review-file-tree__header">
        {visible ? (
          <span className="desktop-review-file-tree__header-label">
            <span>{t('feature.review.workspace.fileBrowser.label')}</span>
            <span className="desktop-review-file-tree__header-count">{files.length}</span>
          </span>
        ) : null}
        <span className="desktop-review-file-tree__header-actions">
          {visible ? (
            <ActionTooltip title={layoutToggleLabel}>
              <IconButton
                aria-pressed={layout === 'flat'}
                className="desktop-review-file-tree__header-button"
                label={layoutToggleLabel}
                title=""
                variant="ghost"
                onClick={toggleLayout}
              >
                {layout === 'tree' ? <List size={14} /> : <ListTree size={14} />}
              </IconButton>
            </ActionTooltip>
          ) : null}
          <ActionTooltip title={visibilityToggleLabel}>
            <IconButton
              className="desktop-review-file-tree__header-button"
              label={visibilityToggleLabel}
              title=""
              variant="ghost"
              onClick={toggleVisible}
            >
              {visible ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </IconButton>
          </ActionTooltip>
        </span>
      </header>
      {visible ? (
        <>
          <label className="desktop-review-file-tree__search">
            <Search size={13} />
            <input
              aria-label={t('feature.review.workspace.fileBrowser.filter')}
              placeholder={t('feature.review.workspace.fileBrowser.filter')}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="desktop-review-file-tree__items">
            {rows.length ? rows : (
              <div className="desktop-review-file-tree__empty">
                {t('feature.review.workspace.fileBrowser.noMatch')}
              </div>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
});

export function buildReviewFileTree(files: DesktopDiffFile[]): ReviewFileTreeNode[] {
  const root: ReviewFileDirectoryNode = {
    children: [],
    name: '',
    path: '',
    type: 'directory',
  };

  for (const file of files) {
    const parts = file.path.split(/[\\/]+/u).filter(Boolean);
    let parent = root;
    let currentPath = '';
    parts.forEach((name, index) => {
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      const isFile = index === parts.length - 1;
      if (isFile) {
        parent.children.push({ file, name, path: currentPath, type: 'file' });
        return;
      }
      let directory = parent.children.find((node): node is ReviewFileDirectoryNode => (
        node.type === 'directory' && node.path === currentPath
      ));
      if (!directory) {
        directory = {
          children: [],
          name,
          path: currentPath,
          type: 'directory',
        };
        parent.children.push(directory);
      }
      parent = directory;
    });
  }

  sortReviewFileTree(root);
  return root.children;
}

function sortReviewFileTree(directory: ReviewFileDirectoryNode): void {
  directory.children.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
    return reviewFilePathCollator.compare(left.name, right.name);
  });
  directory.children.forEach((node) => {
    if (node.type === 'directory') sortReviewFileTree(node);
  });
}

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

function readReviewFileTreeVisible(): boolean {
  return readReviewPreference(REVIEW_FILE_TREE_VISIBLE_STORAGE_KEY) !== 'false';
}

function readReviewFileTreeWidth(): number {
  const storedWidth = readReviewPreference(REVIEW_FILE_TREE_WIDTH_STORAGE_KEY);
  if (storedWidth === null) return REVIEW_FILE_TREE_DEFAULT_WIDTH;
  const parsedWidth = Number(storedWidth);
  return Number.isFinite(parsedWidth)
    ? clampReviewFileTreeWidth(parsedWidth)
    : REVIEW_FILE_TREE_DEFAULT_WIDTH;
}
