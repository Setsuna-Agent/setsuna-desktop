import { Globe2 } from 'lucide-react';
import {
  Children,
  createContext,
  type CSSProperties,
  isValidElement,
  memo,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';
import { WorkspaceFileLink } from './WorkspaceFileLink.js';
import { markdownUrlTransform, resolveMarkdownFileReference, resolveMarkdownLinkTarget } from './markdownLinks.js';
import { remarkAutolinkBoundaries } from './remarkAutolinkBoundaries.js';
import {
  resolveStreamingRevealAnimation,
  type StreamingRevealAnimation,
  type StreamingRevealRange,
} from './streamingReveal.js';

type MarkdownContentBlockProps = {
  content: string;
  revealRanges?: StreamingRevealRange[];
};

type MarkdownElementProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & ExtraProps;
type MarkdownCodeChildProps = { children?: ReactNode; className?: string };
type MarkdownStreamingRevealProps = MarkdownElementProps<'mark'> & {
  'data-stream-reveal'?: number | string;
};

type MarkdownRehypePlugins = NonNullable<ComponentProps<typeof ReactMarkdown>['rehypePlugins']>;
type StreamingRevealOptions = { ranges: StreamingRevealRange[] };
type HastNode = {
  children?: HastNode[];
  position?: {
    end?: { offset?: number };
    start?: { offset?: number };
  };
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
  value?: string;
};

const baseRehypePlugins: MarkdownRehypePlugins = [rehypeKatex];
const remarkPlugins = [remarkGfm, remarkAutolinkBoundaries, remarkMath];
const streamingRevealExcludedTags = new Set(['code', 'math', 'pre', 'script', 'style']);
const StreamingRevealTimelineContext = createContext<Map<string, number> | null>(null);

export const MarkdownContentBlock = memo(function MarkdownContentBlock({
  content,
  revealRanges,
}: MarkdownContentBlockProps) {
  const revealStartedAtByKeyRef = useRef(new Map<string, number>());
  if (!revealRanges?.length && revealStartedAtByKeyRef.current.size) {
    revealStartedAtByKeyRef.current.clear();
  }
  const rehypePlugins = useMemo<MarkdownRehypePlugins>(() => {
    if (!revealRanges?.length) return baseRehypePlugins;
    return [
      ...baseRehypePlugins,
      [rehypeStreamingReveal, { ranges: revealRanges }],
    ];
  }, [revealRanges]);

  return (
    <StreamingRevealTimelineContext.Provider value={revealStartedAtByKeyRef.current}>
      <ReactMarkdown
        components={markdownComponents}
        rehypePlugins={rehypePlugins}
        remarkPlugins={remarkPlugins}
        skipHtml
        urlTransform={markdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </StreamingRevealTimelineContext.Provider>
  );
});

/** Wraps only newly appended prose so settled Markdown never replays the animation. */
function rehypeStreamingReveal(options: StreamingRevealOptions) {
  return (tree: HastNode) => {
    wrapStreamingRevealText(tree, options.ranges, false);
  };
}

function wrapStreamingRevealText(
  node: HastNode,
  ranges: StreamingRevealRange[],
  excluded: boolean,
): void {
  if (!node.children) return;
  const childExcluded = excluded
    || isStreamingRevealExcludedNode(node);
  const nextChildren: HastNode[] = [];

  for (const child of node.children) {
    if (child.type === 'text' && !childExcluded) {
      nextChildren.push(...streamingRevealTextNodes(child, ranges));
      continue;
    }
    wrapStreamingRevealText(child, ranges, childExcluded);
    nextChildren.push(child);
  }
  node.children = nextChildren;
}

function isStreamingRevealExcludedNode(node: HastNode): boolean {
  if (node.type !== 'element') return false;
  if (streamingRevealExcludedTags.has(node.tagName ?? '')) return true;
  const className = node.properties?.className;
  const classes = Array.isArray(className) ? className : [className];
  return classes.some((value) => typeof value === 'string' && value.startsWith('katex'));
}

function streamingRevealTextNodes(
  node: HastNode,
  ranges: StreamingRevealRange[],
): HastNode[] {
  const value = node.value ?? '';
  const startOffset = node.position?.start?.offset;
  const endOffset = node.position?.end?.offset;
  if (
    !value.trim()
    || startOffset === undefined
    || endOffset === undefined
  ) {
    return [node];
  }

  const intersectingRanges = ranges.filter((range) => (
    range.end > startOffset && range.start < endOffset
  ));
  if (!intersectingRanges.length) return [node];

  const sourceLength = endOffset - startOffset;
  if (sourceLength !== value.length) {
    const containingRange = intersectingRanges.find((range) => (
      range.start <= startOffset && range.end >= endOffset
    ));
    return containingRange ? [streamingRevealSpan(node, containingRange.key)] : [node];
  }

  const result: HastNode[] = [];
  let cursor = 0;
  for (const range of intersectingRanges) {
    const rangeStart = Math.max(cursor, range.start - startOffset, 0);
    const rangeEnd = Math.min(value.length, range.end - startOffset);
    if (rangeStart > cursor) result.push(streamingTextNode(node, value.slice(cursor, rangeStart)));
    if (rangeEnd > rangeStart) {
      const textNode = streamingTextNode(node, value.slice(rangeStart, rangeEnd));
      result.push(textNode.value?.trim() ? streamingRevealSpan(textNode, range.key) : textNode);
    }
    cursor = Math.max(cursor, rangeEnd);
  }
  if (cursor < value.length) result.push(streamingTextNode(node, value.slice(cursor)));
  return result;
}

function streamingTextNode(node: HastNode, value: string): HastNode {
  return { ...node, position: undefined, value };
}

function streamingRevealSpan(textNode: HastNode, revealKey: number): HastNode {
  return {
    children: [textNode],
    properties: { 'data-stream-reveal': revealKey },
    // Intercepted below and emitted as a keyed span so every chunk restarts its transition.
    tagName: 'mark',
    type: 'element',
  };
}

const markdownComponents = {
  a: MarkdownLink,
  code: MarkdownInlineCode,
  img: MarkdownImage,
  input: MarkdownTaskInput,
  mark: MarkdownStreamingReveal,
  pre: MarkdownPre,
  table: MarkdownTable,
} satisfies Components;

// GFM 会为任务语法生成复选框输入元素；聊天区将所有 Markdown 列表渲染为静态列表。
function MarkdownTaskInput() {
  return null;
}

function MarkdownStreamingReveal({
  children,
  node: _node,
  ...props
}: MarkdownStreamingRevealProps) {
  const revealKey = String(props['data-stream-reveal'] ?? '');
  const startedAtByKey = useContext(StreamingRevealTimelineContext);
  const animationRef = useRef<{
    key: string;
    value: StreamingRevealAnimation;
  } | null>(null);
  if (animationRef.current?.key !== revealKey) {
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    animationRef.current = {
      key: revealKey,
      value: resolveStreamingRevealAnimation(startedAtByKey ?? new Map(), revealKey, now),
    };
  }
  const animation = animationRef.current.value;
  const style = animation.active
    ? ({ '--chat-markdown-stream-reveal-delay': `${animation.delayMs}ms` } as CSSProperties)
    : undefined;
  return (
    <span
      className={animation.active
        ? 'chat-markdown__stream-reveal is-entering'
        : 'chat-markdown__stream-reveal'}
      style={style}
    >
      {children}
    </span>
  );
}

function MarkdownLink({ children, href, node: _node, onClick, ...props }: MarkdownElementProps<'a'>) {
  const { onOpenWebLink, workspaceRoot } = useMarkdownNavigation();
  const target = resolveMarkdownLinkTarget(href, workspaceRoot);

  if (target.kind === 'workspace') {
    return (
      <WorkspaceFileLink
        {...props}
        filePath={target.path}
        href={href}
        line={target.line}
        linkKind="workspace"
        onClick={onClick}
      >
        {children}
      </WorkspaceFileLink>
    );
  }

  if (target.kind === 'external') {
    const webLink = /^https?:/i.test(target.href);
    const handleExternalClick = (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (webLink && onOpenWebLink) {
        onOpenWebLink(target.href);
        return;
      }
      openExternalMarkdownLink(target.href);
    };
    return (
      <a
        {...props}
        className={[props.className, webLink ? 'chat-markdown__web-link' : ''].filter(Boolean).join(' ') || undefined}
        data-markdown-link={webLink ? 'web' : 'external'}
        href={target.href}
        onClick={handleExternalClick}
        rel="noreferrer"
        target="_blank"
      >
        {children}
        {webLink ? <Globe2 className="chat-markdown__web-link-icon" size={12} aria-hidden="true" /> : null}
      </a>
    );
  }

  if (target.kind === 'anchor') {
    return <a {...props} href={target.href}>{children}</a>;
  }

  return <span className="chat-markdown__unavailable-link">{children}</span>;
}

function MarkdownImage({ alt = '', node: _node, src, ...props }: MarkdownElementProps<'img'>) {
  const { t } = useI18n();
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
        <span aria-hidden="true">{t('chat.markdown.image')}</span>
        <span>{alt || target.path}</span>
      </button>
    );
  }

  return <span className="chat-markdown__image-alt">{alt || t('chat.markdown.imageUnavailable')}</span>;
}

function MarkdownInlineCode({ children, node: _node, ...props }: MarkdownElementProps<'code'>) {
  const { onOpenWorkspaceFile, workspaceRoot } = useMarkdownNavigation();
  const childParts = Children.toArray(children);
  const referenceText = childParts.every((child) => typeof child === 'string' || typeof child === 'number')
    ? childParts.join('')
    : '';
  const target = resolveMarkdownFileReference(referenceText, workspaceRoot);

  if (target && (workspaceRoot || onOpenWorkspaceFile)) {
    return (
      <WorkspaceFileLink
        filePath={target.path}
        href={referenceText}
        line={target.line}
        linkKind="workspace-inline"
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
