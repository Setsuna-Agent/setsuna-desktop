import { workspaceTarget, type WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { Children, createContext, isValidElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { createDesktopRuntimeClient } from '../../../services/runtime-client/client.js';
import { MarkdownCodeBlock } from '../../chat/markdown/MarkdownCodeBlock.js';
import { resolveWorkspaceMarkdownTarget } from './workspaceMarkdownLinks.js';

type PreviewOptions = {
  file: Pick<WorkspaceFileRead, 'path'> & Partial<Pick<WorkspaceFileRead, 'projectId' | 'rootId'>>;
  onOpenFile?: (path: string, line?: number) => void;
  loadImage?: (path: string) => Promise<{ src: string; dispose?(): void } | null>;
};
type ElementProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & ExtraProps;
const PreviewContext = createContext<PreviewOptions | null>(null);
const remarkPlugins = [remarkGfm];
// Sanitize after parsing HTML and generating heading IDs; never execute document scripts or styles.
const rehypePlugins = [rehypeRaw, rehypeSlug, rehypeSanitize];
const components = { a: PreviewLink, img: PreviewImage, pre: PreviewCodeBlock, table: PreviewTable } satisfies Components;

export function WorkspaceMarkdownPreview({ content, file, onOpenFile, loadImage }: PreviewOptions & { content: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div className="desktop-markdown-preview" ref={rootRef} role="region" aria-label={file.path} tabIndex={0}
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
        const anchor = target && resolveWorkspaceMarkdownTarget(target.getAttribute('href') ?? '', file.path);
        if (!anchor || anchor.kind !== 'anchor') return;
        event.preventDefault();
        // Keep heading navigation inside this preview; do not change the app's route/hash.
        const heading = Array.from(rootRef.current?.querySelectorAll('[id]') ?? [])
          .find((element) => element.id === `user-content-${anchor.id}` || element.id === anchor.id);
        heading?.scrollIntoView({ block: 'start' });
      }}>
      <PreviewContext.Provider value={{ file, onOpenFile, loadImage }}>
        <article className="chat-markdown desktop-markdown-preview__document">
          <ReactMarkdown components={components} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
            {content}
          </ReactMarkdown>
        </article>
      </PreviewContext.Provider>
    </div>
  );
}

function PreviewLink({ children, href, node: _node, ...props }: ElementProps<'a'>) {
  const context = useContext(PreviewContext)!;
  const target = resolveWorkspaceMarkdownTarget(href, context.file.path);
  if (target.kind === 'unavailable') return <span>{children}</span>;
  return <a {...props} href={href} onClick={(event) => {
    if (target.kind === 'anchor') return;
    event.preventDefault();
    if (target.kind === 'file') context.onOpenFile?.(target.path, target.line);
    else void window.setsunaDesktop?.links?.openExternal(target.href).catch((error: unknown) => {
      console.error('[WorkspaceMarkdownPreview] failed to open external link', error);
    });
  }}>{children}</a>;
}

function PreviewImage({ src, alt = '', node: _node, ...props }: ElementProps<'img'>) {
  const { file, loadImage } = useContext(PreviewContext)!;
  const target = resolveWorkspaceMarkdownTarget(src, file.path);
  const path = target.kind === 'file' ? target.path : null;
  const [image, setImage] = useState<{ key: string; src: string; loadImage?: PreviewOptions['loadImage'] } | null>(null);
  const key = JSON.stringify([file.projectId, file.rootId, path]);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    async function load() {
      try {
        if (loadImage) {
          const result = await loadImage(path!);
          if (cancelled) { result?.dispose?.(); return; }
          dispose = result?.dispose;
          setImage(result ? { key, src: result.src, loadImage } : null);
        } else if (file.projectId) {
          const result = await createDesktopRuntimeClient().readProjectFile(workspaceTarget(file.projectId, file.rootId), path!);
          if (!cancelled && result.preview?.kind === 'image') {
            setImage({ key, src: `data:${result.preview.mimeType};base64,${result.preview.base64}` });
          }
        }
      } catch { /* Missing or unsupported images retain their accessible alternate text. */ }
    }
    void load();
    return () => { cancelled = true; dispose?.(); };
  }, [file.projectId, file.rootId, key, loadImage, path]);
  const imageSrc = target.kind === 'external' && /^https?:/i.test(target.href)
    ? target.href : image?.key === key && image.loadImage === loadImage ? image.src : undefined;
  return imageSrc
    ? <img {...props} src={imageSrc} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    : <span className="desktop-markdown-preview__image-alt">{alt || src}</span>;
}

function PreviewCodeBlock({ children, node: _node, ...props }: ElementProps<'pre'>) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return <pre {...props}>{children}</pre>;
  return <MarkdownCodeBlock code={String(child.props.children ?? '')}
    language={child.props.className?.match(/language-([\w-]+)/)?.[1]} />;
}

function PreviewTable({ children, node: _node, ...props }: ElementProps<'table'>) {
  return <div className="chat-markdown__table-scroll"><table {...props}>{children}</table></div>;
}
