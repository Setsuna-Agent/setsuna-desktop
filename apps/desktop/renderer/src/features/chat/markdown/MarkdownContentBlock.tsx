import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import {
  Children,
  isValidElement,
  memo,
  useContext,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { MarkdownExternalLink } from './MarkdownExternalLink.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { WorkspaceFileLink } from './WorkspaceFileLink.js';
import { markdownUrlTransform, resolveMarkdownFileReference, resolveMarkdownLinkTarget } from './markdownLinks.js';
import { remarkAutolinkBoundaries } from './remarkAutolinkBoundaries.js';
import { MarkdownImage } from './MarkdownImage.js';
import { MarkdownLinkLabelContext } from './MarkdownLinkLabelContext.js';

type MarkdownElementProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & ExtraProps;
type MarkdownCodeChildProps = { children?: ReactNode; className?: string };

const rehypePlugins = [rehypeKatex];
const remarkPlugins = [remarkGfm, remarkAutolinkBoundaries, remarkMath];

export const MarkdownContentBlock = memo(function MarkdownContentBlock({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={markdownComponents}
      rehypePlugins={rehypePlugins}
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
  input: MarkdownTaskInput,
  pre: MarkdownPre,
  table: MarkdownTable,
} satisfies Components;

// GFM 会为任务语法生成复选框输入元素；聊天区将所有 Markdown 列表渲染为静态列表。
function MarkdownTaskInput() {
  return null;
}

function MarkdownLink({ children, href, node: _node, onClick, ...props }: MarkdownElementProps<'a'>) {
  const { workspaceRoot } = useMarkdownNavigation();
  const target = resolveMarkdownLinkTarget(href, workspaceRoot);
  const label = <MarkdownLinkLabelContext.Provider value>{children}</MarkdownLinkLabelContext.Provider>;

  if (target.kind === 'workspace') {
    return (
      <WorkspaceFileLink
        {...props}
        filePath={href ?? target.path}
        href={href}
        line={target.line}
        linkKind="workspace"
        onClick={onClick}
      >
        {label}
      </WorkspaceFileLink>
    );
  }

  if (target.kind === 'external') {
    return (
      <MarkdownExternalLink {...props} href={target.href} onClick={onClick}>
        {label}
      </MarkdownExternalLink>
    );
  }

  if (target.kind === 'anchor') {
    return <a {...props} href={target.href}>{label}</a>;
  }

  return <span className="chat-markdown__unavailable-link">{label}</span>;
}

function MarkdownInlineCode({ children, node: _node, ...props }: MarkdownElementProps<'code'>) {
  const { onOpenWorkspaceFile, workspaceRoot } = useMarkdownNavigation();
  const isLinkLabel = useContext(MarkdownLinkLabelContext);
  const childParts = Children.toArray(children);
  const referenceText = childParts.every((child) => typeof child === 'string' || typeof child === 'number')
    ? childParts.join('')
    : '';
  const target = isLinkLabel ? null : resolveMarkdownFileReference(referenceText, workspaceRoot);

  if (target && (workspaceRoot || onOpenWorkspaceFile)) {
    return (
      <WorkspaceFileLink
        filePath={referenceText}
        href={referenceText}
        line={target.line}
        linkKind="workspace-inline"
        unavailableContent={<code {...props}>{children}</code>}
      >
        {children}
      </WorkspaceFileLink>
    );
  }

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
  const { t } = useI18n();
  return (
    <div
      className="chat-markdown__table-scroll"
      role="region"
      aria-label={t('chat.markdown.table')}
      tabIndex={0}
    >
      <table {...props}>{children}</table>
    </div>
  );
}
