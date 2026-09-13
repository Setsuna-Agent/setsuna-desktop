import type { SettingsMarkdownDocumentProps } from '@setsuna-desktop/renderer-contracts/settings';
import { Button } from '@setsuna-desktop/renderer-ui';
import { useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

const remarkPlugins = [remarkGfm];
// Bundled and imported documents are untrusted, including their inline HTML.
const rehypePlugins = [rehypeRaw, rehypeSlug, rehypeSanitize];
const components: Components = {
  a: ({ children, href }) => href && /^(?:https?:|mailto:|#)/iu.test(href)
    ? <a href={href}>{children}</a> : <span>{children}</span>,
  img: ({ src, alt }) => src && /^https?:\/\//iu.test(src)
    ? <img src={src} alt={alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    : <span>{alt || src}</span>,
  table: ({ children }) => <div className="chat-markdown__table-scroll"><table>{children}</table></div>,
};

/** Shared reading surface for Skill details and plugin documents; source is an explicit choice. */
export function SettingsMarkdownDocument({ content, name, previewLabel, sourceLabel }: SettingsMarkdownDocumentProps) {
  const [source, setSource] = useState(false);
  const root = useRef<HTMLElement>(null);
  return <article className="desktop-markdown-document" ref={root}>
    <header>
      <h3>{name}</h3>
      <div className="desktop-markdown-document__view-switch" role="group" aria-label={name}>
        <Button variant="ghost" aria-pressed={!source} onClick={() => setSource(false)}>{previewLabel}</Button>
        <Button variant="ghost" aria-pressed={source} onClick={() => setSource(true)}>{sourceLabel}</Button>
      </div>
    </header>
    {source ? <pre className="desktop-markdown-document__source" tabIndex={0}>{content}</pre> : (
      <div className="chat-markdown desktop-markdown-document__preview" tabIndex={0} onClick={(event) => {
        const link = event.target instanceof Element ? event.target.closest('a') : null;
        const href = link?.getAttribute('href');
        if (!href) return;
        event.preventDefault();
        if (href.startsWith('#')) {
          let id: string;
          try { id = decodeURIComponent(href.slice(1)); } catch { return; }
          // Heading links scroll this document without changing the workbench route.
          const heading = Array.from(root.current?.querySelectorAll('[id]') ?? [])
            .find((element) => element.id === `user-content-${id}` || element.id === id);
          heading?.scrollIntoView({ block: 'start' });
        } else {
          void window.setsunaDesktop?.links.openExternal(href).catch((error: unknown) => {
            console.error('[SettingsMarkdownDocument] failed to open link', error);
          });
        }
      }}>
        <ReactMarkdown components={components} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
          {markdownBody(content)}
        </ReactMarkdown>
      </div>
    )}
  </article>;
}

function markdownBody(content: string): string {
  const frontmatter = content.match(/^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/u);
  return frontmatter?.[1] && /^(?:[A-Za-z_][\w.-]*):(?:[\t ]|$)/mu.test(frontmatter[1])
    ? content.slice(frontmatter[0].length)
    : content;
}
