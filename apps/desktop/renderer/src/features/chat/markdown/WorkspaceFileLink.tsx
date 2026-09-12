import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import type { AnchorHTMLAttributes, HTMLAttributes, MouseEvent, ReactNode } from 'react';
import { WorkspaceFileIcon } from '../../workspace/WorkspaceFileIcon.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { resolveMarkdownLinkTarget } from './markdownLinks.js';
import { useAvailableMarkdownFile } from './useMarkdownWorkspaceFiles.js';

type WorkspaceFileLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'href'> & {
  children?: ReactNode;
  filePath: string;
  href?: string;
  line?: number;
  linkKind: 'workspace' | 'workspace-inline' | 'workspace-tool';
  unavailableClassName?: string;
  unavailableContent?: ReactNode;
};

type WorkspacePathLabelProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children?: ReactNode;
  path: string;
  type: WorkspaceEntry['type'];
};

/** Markdown 和 runtime 工具行中的工作区文件引用所共用的渲染器。 */
export function WorkspaceFileLink({
  children,
  className,
  filePath,
  href,
  line,
  linkKind,
  onClick,
  onContextMenu,
  unavailableClassName = 'chat-markdown__unavailable-link',
  unavailableContent,
  ...props
}: WorkspaceFileLinkProps) {
  const {
    onOpenWorkspaceFile,
    onOpenWorkspaceFileContextMenu,
    workspaceRoot,
    workspaceFiles,
  } = useMarkdownNavigation();
  const target = resolveMarkdownLinkTarget(filePath, workspaceRoot);
  const candidate = target.kind === 'workspace' ? target.path : null;
  // Structured tool paths already come from tool results; Markdown references
  // must be checked against directory entries before they become interactive.
  const checkFile = linkKind !== 'workspace-tool';
  const verifiedPath = useAvailableMarkdownFile(checkFile ? candidate : null, workspaceFiles);
  const availablePath = checkFile ? verifiedPath : candidate;
  const label = children ?? (target.kind === 'workspace' ? target.path : filePath);

  if (target.kind !== 'workspace' || !availablePath || (!workspaceRoot && !onOpenWorkspaceFile)) {
    return <span className={[unavailableClassName, className].filter(Boolean).join(' ') || undefined}>{unavailableContent ?? label}</span>;
  }

  const handleWorkspaceClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    openWorkspaceFileReference(workspaceRoot, availablePath, line ?? target.line, onOpenWorkspaceFile);
  };
  const handleWorkspaceContextMenu = (event: MouseEvent<HTMLAnchorElement>) => {
    onContextMenu?.(event);
    if (event.defaultPrevented || !onOpenWorkspaceFileContextMenu) return;
    event.preventDefault();
    onOpenWorkspaceFileContextMenu({
      filePath: availablePath,
      line: line ?? target.line,
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <a
      {...props}
      className={['chat-markdown__file-link', className].filter(Boolean).join(' ')}
      data-markdown-link={linkKind}
      href={href ?? filePath}
      title={availablePath}
      onClick={handleWorkspaceClick}
      onContextMenu={handleWorkspaceContextMenu}
    >
      <WorkspaceFileIcon className="chat-markdown__file-icon" path={availablePath} type="file" />
      <span>{label}</span>
    </a>
  );
}

/** 工作区路径的非交互式配套组件，用于无法作为文件打开的目录等情况。 */
export function WorkspacePathLabel({ children, className, path, title, type, ...props }: WorkspacePathLabelProps) {
  const { workspaceRoot } = useMarkdownNavigation();
  const target = resolveMarkdownLinkTarget(path, workspaceRoot);
  const resolvedPath = target.kind === 'workspace' ? target.path : path;
  return (
    <span
      {...props}
      className={['chat-workspace-path-label', className].filter(Boolean).join(' ')}
      title={title ?? resolvedPath}
    >
      <WorkspaceFileIcon className="chat-markdown__file-icon" path={resolvedPath} type={type} />
      <span>{children ?? resolvedPath}</span>
    </span>
  );
}

export function openWorkspaceFileReference(
  workspaceRoot: string | undefined,
  filePath: string,
  line: number | undefined,
  preferredOpen: ((filePath: string, line?: number) => void) | undefined,
): void {
  if (preferredOpen) {
    preferredOpen(filePath, line);
    return;
  }
  const openFile = typeof window === 'undefined'
    ? undefined
    : window.setsunaDesktop?.desktop?.openWorkspaceFile;
  if (workspaceRoot && openFile) {
    void openFile(workspaceRoot, filePath)
      .then((result) => {
        if (!result.ok) console.error('[WorkspaceFileLink] failed to open workspace file', result.error);
      })
      .catch((error: unknown) => {
        console.error('[WorkspaceFileLink] failed to open workspace file', error);
      });
    return;
  }
}
