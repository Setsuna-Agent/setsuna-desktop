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

/** Shared renderer for workspace file references in Markdown and runtime tool rows. */
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
    openWorkspaceFile(workspaceRoot, target.path, line ?? target.line, onOpenWorkspaceFile);
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

/** Non-interactive companion for workspace paths, such as directories that cannot open as files. */
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

function openWorkspaceFile(
  workspaceRoot: string | undefined,
  filePath: string,
  line: number | undefined,
  fallback: ((filePath: string, line?: number) => void) | undefined,
): void {
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
  fallback?.(filePath, line);
}
