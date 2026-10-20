import { Children, isValidElement, useMemo, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import remarkEmoji from 'remark-emoji';
import { CheckField } from './selection-controls.js';
import { rehypeGitHubAlerts } from './markdown/github-alerts.js';
import { MermaidDiagram } from './mermaid-diagram.js';

const remarkPlugins = [remarkGfm, remarkEmoji];
const rehypePlugins = [rehypeRaw, rehypeSlug, rehypeSanitize, rehypeGitHubAlerts];

export type DocumentMarkdownProps = {
  content: string; baseUrl?: string; className?: string; onOpenLink?(url: string): void;
};

/** Sanitized GFM for both the host and isolated apps; native link handling is injected. */
export function DocumentMarkdown({ content, baseUrl, className = '', onOpenLink }: DocumentMarkdownProps) {
  const root = useRef<HTMLDivElement>(null);
  const components = useMemo<Components>(() => ({
    a: ({ children, href }) => {
      const target = documentUrl(href, baseUrl);
      return target ? <a href={target} target={!onOpenLink && !target.startsWith('#') ? '_blank' : undefined}
        rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
    },
    img: ({ src, alt }) => {
      const target = documentUrl(src, baseUrl, true);
      return target ? <img src={target} alt={alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span>{alt || src}</span>;
    },
    input: ({ checked, disabled }) => <CheckField checked={Boolean(checked)} disabled={disabled} readOnly />,
    pre: DocumentCodeBlock,
    table: ({ children }) => <div className="chat-markdown__table-scroll"><table>{children}</table></div>,
  }), [baseUrl, onOpenLink]);
  return <div ref={root} className={`chat-markdown sd-document-markdown ${className}`} tabIndex={0} onClick={(event) => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    const href = link?.getAttribute('href');
    if (!href) return;
    if (href.startsWith('#')) {
      event.preventDefault();
      let id: string;
      try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      const heading = Array.from(root.current?.querySelectorAll('[id]') ?? []).find((element) => element.id === id || element.id === `user-content-${id}`);
      heading?.scrollIntoView({ block: 'start' });
    } else if (onOpenLink) {
      event.preventDefault();
      onOpenLink(href);
    }
  }}><ReactMarkdown components={components} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{content}</ReactMarkdown></div>;
}

function DocumentCodeBlock({ children, node: _node, ...props }: ComponentPropsWithoutRef<'pre'> & ExtraProps) {
  const source = <pre {...props}>{children}</pre>;
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return source;
  const language = child.props.className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase();
  return language === 'mermaid'
    ? <MermaidDiagram code={String(child.props.children ?? '')} fallback={source} />
    : source;
}

export function documentUrl(value: string | undefined, base?: string, image = false): string | null {
  if (!value) return null;
  if (value.startsWith('#')) return image ? null : value;
  try {
    const url = new URL(value, base);
    if (url.username || url.password || !['https:', 'http:', ...(image ? [] : ['mailto:'])].includes(url.protocol)) return null;
    if (image && url.hostname === 'github.com') {
      const match = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/u.exec(url.pathname);
      if (match) return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
    }
    return base ? url.toString() : value;
  } catch { return null; }
}
