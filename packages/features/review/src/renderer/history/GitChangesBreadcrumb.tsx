import { Button, FileTreeRow, FileTreeSurface, Popover } from '@setsuna-desktop/renderer-ui';
import { ChevronRight } from 'lucide-react';
import { Fragment, useMemo, useRef, useState, type RefObject } from 'react';
import type { DesktopGitChangedFile } from '../../contracts/index.js';
import { useReviewRendererHost } from '../host.js';
import { buildReviewFileTree, type ReviewFileTreeNode } from '../model/reviewFileTree.js';
import { ReviewFileIcon } from '../ReviewFileVisuals.js';

export function GitChangesBreadcrumb({ file, files, onSelect }: {
  file: DesktopGitChangedFile;
  files: DesktopGitChangedFile[];
  onSelect(file: DesktopGitChangedFile): void;
}) {
  const { translate: t } = useReviewRendererHost();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const parts = file.path.split(/[\\/]+/u).filter(Boolean);
  const segment = (name: string, index: number, current: boolean) => {
    const directory = parts.slice(0, current ? index : index + 1).join('/');
    return <Popover open={openIndex === index} onOpenChange={(open) => setOpenIndex(open ? index : null)}
      placement="bottomLeft" className="sd-menu-surface sd-menu-surface--neutral git-changes-breadcrumb__popover"
      contentLabel={directory || t('feature.review.history.filePath')}
      onOpenAutoFocus={(event) => {
        const selected = selectedRef.current;
        if (!selected) return;
        event.preventDefault();
        selected.focus({ preventScroll: true });
        selected.scrollIntoView?.({ block: 'nearest' });
      }}
      content={openIndex === index ? <BreadcrumbFileTree key={directory} directory={directory} files={files}
        selectedPath={file.path} selectedRef={selectedRef}
        onSelect={(selected) => { setOpenIndex(null); onSelect(selected); }} /> : null}>
      <Button variant="ghost" size="small" className={'git-changes-breadcrumb__segment' + (current ? ' is-current' : '')}
        aria-current={current ? 'page' : undefined} title={current ? file.path : directory}><span>{name}</span></Button>
    </Popover>;
  };
  return <nav className="git-changes-breadcrumb" aria-label={t('feature.review.history.filePath')}>
    {parts.length > 1 ? <span className="git-changes-breadcrumb__parents"><span className="git-changes-breadcrumb__segments">
      {parts.slice(0, -1).map((name, index) => <Fragment key={parts.slice(0, index + 1).join('/')}>
        {segment(name, index, false)}<ChevronRight aria-hidden="true" size={12} />
      </Fragment>)}
    </span></span> : null}
    {segment(parts.at(-1) ?? file.path, parts.length - 1, true)}
  </nav>;
}

function BreadcrumbFileTree({ directory, files, selectedPath, selectedRef, onSelect }: {
  directory: string;
  files: DesktopGitChangedFile[];
  selectedPath: string;
  selectedRef: RefObject<HTMLButtonElement>;
  onSelect(file: DesktopGitChangedFile): void;
}) {
  // Build only while a path popup is open; the normal panel mount does no extra tree work.
  const tree = useMemo(() => buildReviewFileTree(files, false), [files]);
  const [expanded, setExpanded] = useState(() => {
    const parts = selectedPath.split(/[\\/]+/u).filter(Boolean);
    return new Set(parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/')));
  });
  const layoutDependency = useMemo(() => [tree, expanded], [tree, expanded]);
  let nodes = tree;
  const parts = directory.split('/').filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const path = parts.slice(0, index + 1).join('/');
    const node = nodes.find((entry) => entry.type === 'directory' && entry.path === path);
    nodes = node?.type === 'directory' ? node.children : [];
  }
  const renderNode = (node: ReviewFileTreeNode<DesktopGitChangedFile>, depth = 0): JSX.Element => {
    const folder = node.type === 'directory';
    const opened = folder && expanded.has(node.path);
    return <div key={node.path}>
      <FileTreeRow depth={depth} label={node.name} title={node.path} aria-label={node.path}
        ref={!folder && node.file.path === selectedPath ? selectedRef : undefined}
        selected={!folder && node.file.path === selectedPath} expanded={folder ? opened : undefined}
        icon={folder ? undefined : <ReviewFileIcon path={node.file.path} />}
        onClick={() => {
          if (!folder) { onSelect(node.file); return; }
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
            return next;
          });
        }} />
      {node.type === 'directory' && opened ? node.children.map((child) => renderNode(child, depth + 1)) : null}
    </div>;
  };
  return <FileTreeSurface className="git-changes-breadcrumb__tree" layoutDependency={layoutDependency}>
    {nodes.map((node) => renderNode(node))}
  </FileTreeSurface>;
}
