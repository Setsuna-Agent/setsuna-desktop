import type { AnchorHTMLAttributes, HTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { WorkspaceEntry } from '@setsuna-desktop/contracts';
import { WorkspaceFileIcon } from '../../workspace/WorkspaceFileIcon.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { resolveMarkdownLinkTarget } from './markdownLinks.js';

type WorkspaceFileLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'href'> & {
  children?: ReactNode;
  filePath: string;
  href?: string;
  line?: number;
  linkKind: 'workspace' | 'workspace-inline' | 'workspace-tool';
  unavailableClassName?: string;
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
  unavailableClassName = 'chat-markdown__unavailable-link',
  ...props
}: WorkspaceFileLinkProps) {
  const { onOpenWorkspaceFile, workspaceRoot } = useMarkdownNavigation();
  const target = resolveMarkdownLinkTarget(filePath, workspaceRoot);
  const label = children ?? (target.kind === 'workspace' ? target.path : filePath);

  if (target.kind !== 'workspace' || (!workspaceRoot && !onOpenWorkspaceFile)) {
    return <span className={[unavailableClassName, className].filter(Boolean).join(' ') || undefined}>{label}</span>;
  }

  const handleWorkspaceClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    openWorkspaceFileReference(workspaceRoot, target.path, line ?? target.line, onOpenWorkspaceFile);
  };

  return (
    <a
      {...props}
      className={['chat-markdown__file-link', className].filter(Boolean).join(' ')}
      data-markdown-link={linkKind}
      href={href ?? filePath}
      title={target.path}
      onClick={handleWorkspaceClick}
    >
      <WorkspaceFileIcon className="chat-markdown__file-icon" path={target.path} type="file" />
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
