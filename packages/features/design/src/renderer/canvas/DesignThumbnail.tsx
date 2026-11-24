import { useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { DesignDocumentRef } from '../../contracts/index.js';
import type { LoadDesignImage } from '../design-images.js';
import { designExportBounds, designExportImagePaths, type DesignExportSelection } from '../export/design-export-scene.js';
import type { DesignShaderSources } from '../shaders/design-shader-renderer.js';
import { DesignShaderAssetsContext } from '../shaders/use-design-shader-assets.js';
import './design-thumbnail.css';

type ThumbnailPreview = Readonly<{ src?: string; libraries?: readonly DesignDocumentRef[] }>;
type Thumbnail = Readonly<{ source: object; src?: string; libraries?: readonly { ref: DesignDocumentRef; revision?: string }[] }>;
type ThumbnailUpdate = (src: string | undefined) => void;
type ObserveThumbnail = (id: string, element: HTMLSpanElement, update: ThumbnailUpdate) => () => void;
type RenderThumbnail = (id: string, signal: AbortSignal) => Promise<ThumbnailPreview | undefined>;
export type DesignThumbnailSelection = (id: string) => DesignExportSelection | undefined;
const thumbnailCacheSize = 80;

export function DesignThumbnail({ id, observe, fallback, waitForDecode }: Readonly<{
  id: string;
  observe: ObserveThumbnail;
  fallback?: ReactNode;
  waitForDecode?: boolean;
}>) {
  const [src, setSrc] = useState<string>();
  const [decodedSrc, setDecodedSrc] = useState<string>();
  const unobserve = useRef<() => void>();
  const ref = useCallback((element: HTMLSpanElement | null) => {
    unobserve.current?.();
    unobserve.current = element ? observe(id, element, setSrc) : undefined;
  }, [id, observe]);
  const decodeImage = useCallback((image: HTMLImageElement | null) => {
    if (!image || !src) return;
    void image.decode().then(() => {
      if (image.isConnected && image.getAttribute('src') === src) setDecodedSrc(src);
    }, () => undefined);
  }, [src]);
  const pending = waitForDecode && src !== decodedSrc;
  return <span ref={ref} data-design-thumbnail={id} className="design-thumbnail" aria-hidden="true">
    {!src || pending ? fallback : null}
    {src ? <img ref={waitForDecode ? decodeImage : undefined} src={src} alt="" decoding="async" draggable={false} hidden={pending} /> : null}
  </span>;
}

export function useDesignThumbnails(list: RefObject<HTMLDivElement>, select: DesignThumbnailSelection, loadImage: LoadDesignImage,
  { open = true, pixels = 64 }: Readonly<{ open?: boolean; pixels?: number }> = {},
) {
  const shaders = useContext(DesignShaderAssetsContext)?.sources;
  const shaderSources = shaders?.size ? shaders : undefined;
  const render = useCallback<RenderThumbnail>(async (id, signal) => {
    const selection = select(id);
    if (selection) return { src: await renderDesignThumbnail(selection, loadImage, pixels, signal, shaderSources) };
  }, [loadImage, pixels, select, shaderSources]);
  return useDesignThumbnailRenderer(list, render, open);
}

export function useDesignThumbnailRenderer(list: RefObject<HTMLElement>, render: RenderThumbnail, open: boolean, source: object = render,
  libraryRevision?: (ref: DesignDocumentRef) => string | undefined,
) {
  const rows = useRef(new Map<string, Map<Element, ThumbnailUpdate>>());
  const observer = useRef<IntersectionObserver>();
  const [nearby, setNearby] = useState<ReadonlySet<Element>>(() => new Set());
  const cache = useRef(new Map<string, Thumbnail>());
  const queue = useRef(Promise.resolve());

  const observe = useCallback<ObserveThumbnail>((id, element, update) => {
    const group = rows.current.get(id) ?? new Map<Element, ThumbnailUpdate>();
    group.set(element, update);
    rows.current.set(id, group);
    update(cache.current.get(id)?.src);
    observer.current?.observe(element);
    return () => {
      observer.current?.unobserve(element);
      group.delete(element);
      if (!group.size) rows.current.delete(id);
      setNearby((current) => {
        if (!current.has(element)) return current;
        const next = new Set(current);
        next.delete(element);
        return next;
      });
    };
  }, []);

  useEffect(() => {
    const root = list.current;
    if (!open || !root || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver((entries) => {
      setNearby((current) => {
        const next = new Set(current);
        for (const { target, isIntersecting } of entries) {
          const id = target.getAttribute('data-design-thumbnail');
          if (!id || !rows.current.get(id)?.has(target)) continue;
          if (isIntersecting) next.add(target);
          else next.delete(target);
        }
        return next.size === current.size && [...next].every((element) => current.has(element)) ? current : next;
      });
    }, { root, rootMargin: '40px' });
    observer.current = watch;
    rows.current.forEach((group) => group.forEach((_, element) => watch.observe(element)));
    return () => { watch.disconnect(); observer.current = undefined; };
  }, [list, open]);

  useEffect(() => {
    if (!open || !nearby.size) return;
    const controller = new AbortController();
    const { signal } = controller;

    async function renderNearby() {
      const ids = new Set(Array.from(nearby, (element) => element.getAttribute('data-design-thumbnail')));
      for (const id of ids) {
        if (signal.aborted) return;
        if (!id || !rows.current.has(id)) continue;
        const cached = cache.current.get(id);
        if (cached?.source === source && !cached.libraries?.some(({ ref, revision }) => libraryRevision?.(ref) !== revision)) continue;
        await waitForIdle(signal);
        if (signal.aborted) return;
        let preview: ThumbnailPreview | undefined;
        try {
          preview = await render(id, signal);
        } catch {
          // A failed preview must leave the row operable and the rest of the queue running.
        }
        if (signal.aborted) return;
        const thumbnails = cache.current;
        thumbnails.delete(id);
        const libraries = preview?.libraries?.map((ref) => ({ ref, revision: libraryRevision?.(ref) }));
        thumbnails.set(id, { source, src: preview?.src, libraries });
        if (thumbnails.size > thumbnailCacheSize) {
          const oldest = thumbnails.keys().next().value;
          if (oldest !== undefined) {
            thumbnails.delete(oldest);
            rows.current.get(oldest)?.forEach((update) => update(undefined));
          }
        }
        rows.current.get(id)?.forEach((update) => update(preview?.src));
      }
    }

    // Scroll changes cancel obsolete work without starting a second render while it is unwinding.
    queue.current = queue.current.then(renderNearby).catch(() => undefined);
    return () => controller.abort();
  }, [nearby, open, render, source, libraryRevision]);

  return observe;
}

export async function renderDesignThumbnail(selection: DesignExportSelection, loadImage: LoadDesignImage, pixels: number,
  signal: AbortSignal, shaderSources?: DesignShaderSources,
) {
  const bounds = designExportBounds(selection);
  if (!bounds) return;
  const paths = designExportImagePaths(selection);
  const images = new Map<string, HTMLImageElement>();
  for (const path of paths) {
    const image = await loadImage(path).catch(() => undefined);
    signal.throwIfAborted();
    if (image) images.set(path, image);
  }
  const { renderDesignPng } = await import('../export/export-design-png.js');
  if (paths.length) await waitForIdle(signal);
  signal.throwIfAborted();
  const pixelRatio = pixels / Math.max(1, Math.ceil(bounds.width), Math.ceil(bounds.height));
  // Thin paths still need one output pixel on the shorter axis.
  const minimum = Math.ceil(1 / pixelRatio);
  const width = Math.max(minimum, Math.ceil(bounds.width));
  const height = Math.max(minimum, Math.ceil(bounds.height));
  const crop = { x: bounds.x - (width - bounds.width) / 2, y: bounds.y - (height - bounds.height) / 2, width, height };
  return renderDesignPng(selection, crop, images, pixelRatio, shaderSources);
}

function waitForIdle(signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const idle = typeof window.requestIdleCallback === 'function';
    function finish() {
      signal.removeEventListener('abort', cancel);
      resolve();
    }
    const frame = idle ? window.requestIdleCallback(finish, { timeout: 250 }) : window.requestAnimationFrame(finish);
    function cancel() {
      if (idle) window.cancelIdleCallback(frame);
      else window.cancelAnimationFrame(frame);
      finish();
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
}
