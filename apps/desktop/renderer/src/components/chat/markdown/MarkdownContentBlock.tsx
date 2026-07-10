import { Children, isValidElement, memo, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { markdownUrlTransform, resolveMarkdownLinkTarget } from './markdownLinks.js';

type MarkdownContentBlockProps = {
  content: string;
};

type MarkdownElementProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & ExtraProps;
type MarkdownCodeChildProps = { children?: ReactNode; className?: string };

const remarkPlugins = [remarkGfm];

export const MarkdownContentBlock = memo(function MarkdownContentBlock({ content }: MarkdownContentBlockProps) {
  return (
    <ReactMarkdown
      components={markdownComponents}
      remarkPlugins={remarkPlugins}
      skipHtml
      urlTransform={markdownUrlTransform}
    >
      {content}
    </ReactMarkdown>
  );
});

const markdownComponents = {
  a: MarkdownLink,
  code: MarkdownInlineCode,
  img: MarkdownImage,
  pre: MarkdownPre,
  table: MarkdownTable,
} satisfies Components;

function MarkdownLink({ children, href, node: _node, onClick, ...props }: MarkdownElementProps<'a'>) {
  const { onOpenWorkspaceFile, workspaceRoot } = useMarkdownNavigation();
  const target = resolveMarkdownLinkTarget(href, workspaceRoot);

  if (target.kind === 'workspace') {
    if (!onOpenWorkspaceFile) {
      return <span className="chat-markdown__unavailable-link">{children}</span>;
    }
    const handleWorkspaceClick = (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      onOpenWorkspaceFile(target.path, target.line);
    };
    return (
      <a {...props} data-markdown-link="workspace" href={href} onClick={handleWorkspaceClick}>
        {children}
      </a>
    );
  }

  if (target.kind === 'external') {
    const handleExternalClick = (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      openExternalMarkdownLink(target.href);
    };
    return (
      <a {...props} href={target.href} onClick={handleExternalClick} rel="noreferrer" target="_blank">
        {children}
      </a>
    );
  }

  if (target.kind === 'anchor') {
    return <a {...props} href={target.href}>{children}</a>;
  }

  return <span className="chat-markdown__unavailable-link">{children}</span>;
}

function MarkdownImage({ alt = '', node: _node, src, ...props }: MarkdownElementProps<'img'>) {
  const { onOpenWorkspaceFile, workspaceRoot } = useMarkdownNavigation();
  const target = resolveMarkdownLinkTarget(src, workspaceRoot);

  if (target.kind === 'external' && /^https?:/i.test(target.href)) {
    return (
      <img
        {...props}
        alt={alt}
        decoding="async"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={target.href}
      />
    );
  }

  if (target.kind === 'workspace' && onOpenWorkspaceFile) {
    return (
      <button
        className="chat-markdown__local-image"
        type="button"
        onClick={() => onOpenWorkspaceFile(target.path, target.line)}
      >
        <span aria-hidden="true">图片</span>
        <span>{alt || target.path}</span>
      </button>
    );
  }

  return <span className="chat-markdown__image-alt">{alt || '无法显示的图片'}</span>;
}

function MarkdownInlineCode({ children, node: _node, ...props }: MarkdownElementProps<'code'>) {
  return <code {...props}>{children}</code>;
}

function MarkdownPre({ children, node: _node, ...props }: MarkdownElementProps<'pre'>) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<MarkdownCodeChildProps>(child)) {
    return <pre {...props}>{children}</pre>;
  }
  const language = child.props.className?.match(/language-([\w-]+)/)?.[1] ?? '';
  return <MarkdownCodeBlock code={String(child.props.children ?? '')} language={language} />;
}

function MarkdownTable({ children, node: _node, ...props }: MarkdownElementProps<'table'>) {
  return (
    <div className="chat-markdown__table-scroll" role="region" aria-label="Markdown 表格" tabIndex={0}>
      <table {...props}>{children}</table>
    </div>
  );
}

function openExternalMarkdownLink(href: string): void {
  if (typeof window === 'undefined') return;
  const openExternal = window.setsunaDesktop?.links?.openExternal;
  if (openExternal) {
    void openExternal(href).catch((error: unknown) => {
      console.error('[MarkdownContentBlock] failed to open external link', error);
    });
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}
