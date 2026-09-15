import { useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeRaw, rehypeSlug, rehypeSanitize];

/** Shared sanitized GFM reading surface for plugin documents and remote repository content. */
export function DocumentMarkdown({ content, baseUrl, className = '', onOpenLink }: {
  content: string; baseUrl?: string; className?: string; onOpenLink(url: string): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const components = useMemo<Components>(() => ({
    a: ({ children, href }) => {
      const target = documentUrl(href, baseUrl);
      return target ? <a href={target}>{children}</a> : <span>{children}</span>;
    },
    img: ({ src, alt }) => {
      const target = documentUrl(src, baseUrl, true);
      return target ? <img src={target} alt={alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span>{alt || src}</span>;
    },
    table: ({ children }) => <div className="chat-markdown__table-scroll"><table>{children}</table></div>,
  }), [baseUrl]);
  return <div ref={root} className={`chat-markdown ${className}`} tabIndex={0} onClick={(event) => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    const href = link?.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    if (href.startsWith('#')) {
      let id: string;
      try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      const heading = [...(root.current?.querySelectorAll('[id]') ?? [])].find((element) => element.id === id || element.id === `user-content-${id}`);
      heading?.scrollIntoView({ block: 'start' });
    } else onOpenLink(href);
  }}><ReactMarkdown components={components} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{content}</ReactMarkdown></div>;
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
