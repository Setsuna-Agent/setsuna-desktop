import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { LoadDesignImage } from '../design-images.js';
import { designExportBounds, designExportImagePaths, type DesignExportSelection } from '../export/design-export-scene.js';
import { DesignShaderAssetsContext } from '../shaders/use-design-shader-assets.js';
import './design-thumbnail.css';

type Thumbnail = Readonly<{ source: symbol; src?: string }>;
type ThumbnailUpdate = (src: string | undefined) => void;
type ObserveThumbnail = (id: string, element: HTMLSpanElement | null, update: ThumbnailUpdate) => void;
export type DesignThumbnailSelection = (id: string) => DesignExportSelection | undefined;
const thumbnailCacheSize = 80;

export function DesignThumbnail({ id, observe, fallback }: Readonly<{ id: string; observe: ObserveThumbnail; fallback?: ReactNode }>) {
  const [src, setSrc] = useState<string>();
  const ref = useCallback((element: HTMLSpanElement | null) => observe(id, element, setSrc), [id, observe]);
  return <span ref={ref} data-design-thumbnail={id} className="design-thumbnail" aria-hidden="true">
    {src ? <img src={src} alt="" decoding="async" draggable={false} /> : fallback}
  </span>;
}

export function useDesignThumbnails(list: RefObject<HTMLDivElement>, select: DesignThumbnailSelection, loadImage: LoadDesignImage,
  { open = true, pixels = 64 }: Readonly<{ open?: boolean; pixels?: number }> = {},
) {
  const rows = useRef(new Map<string, { element: HTMLSpanElement; update: ThumbnailUpdate }>());
  const observer = useRef<IntersectionObserver>();
  const [nearby, setNearby] = useState<ReadonlySet<string>>(() => new Set());
  const cache = useRef(new Map<string, Thumbnail>());
  const shaders = useContext(DesignShaderAssetsContext)?.sources;
  const shaderSources = shaders?.size ? shaders : undefined;
  const source = useMemo(() => Symbol(), [select, loadImage, pixels, shaderSources]);

  const observe = useCallback<ObserveThumbnail>((id, element, update) => {
    const previous = rows.current.get(id);
    if (previous) observer.current?.unobserve(previous.element);
    if (element) {
      rows.current.set(id, { element, update });
      update(cache.current.get(id)?.src);
      observer.current?.observe(element);
    } else {
      rows.current.delete(id);
      setNearby((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    const root = list.current;
    if (!open || !root || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver((entries) => {
      setNearby((current) => {
        const next = new Set(current);
        for (const { target, isIntersecting } of entries) {
          const id = target.getAttribute('data-design-thumbnail');
          if (!id || rows.current.get(id)?.element !== target) continue;
          if (isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
      });
    }, { root, rootMargin: '40px' });
    observer.current = watch;
    rows.current.forEach(({ element }) => watch.observe(element));
    return () => { watch.disconnect(); observer.current = undefined; };
  }, [list, open]);

  useEffect(() => {
    if (!open || !nearby.size) return;
    const controller = new AbortController();
    const { signal } = controller;

    async function render() {
      const { renderDesignPng } = await import('../export/export-design-png.js');
      for (const id of nearby) {
        if (signal.aborted) return;
        if (cache.current.get(id)?.source === source) continue;
        await waitForIdle(signal);
        if (signal.aborted) return;
        let src: string | undefined;
        try {
          const selection = select(id);
          const bounds = selection && designExportBounds(selection);
          if (selection && bounds) {
            // Use the editor's cached assets and yield before drawing another thumbnail.
            const paths = designExportImagePaths(selection);
            const images = new Map<string, HTMLImageElement>();
            for (const path of paths) {
              const image = await loadImage(path).catch(() => undefined);
              if (signal.aborted) return;
              if (image) images.set(path, image);
            }
            if (paths.length) await waitForIdle(signal);
            if (signal.aborted) return;
            const pixelRatio = pixels / Math.max(1, Math.ceil(bounds.width), Math.ceil(bounds.height));
            // Thin paths still need one output pixel on the shorter axis.
            const minimum = Math.ceil(1 / pixelRatio);
            const width = Math.max(minimum, Math.ceil(bounds.width));
            const height = Math.max(minimum, Math.ceil(bounds.height));
            const crop = { x: bounds.x - (width - bounds.width) / 2, y: bounds.y - (height - bounds.height) / 2, width, height };
            src = shaderSources ? renderDesignPng(selection, crop, images, pixelRatio, shaderSources) : renderDesignPng(selection, crop, images, pixelRatio);
          }
        } catch {
          // A failed preview must leave the row operable and the rest of the queue running.
        }
        const thumbnails = cache.current;
        thumbnails.delete(id);
        thumbnails.set(id, { source, src });
        if (thumbnails.size > thumbnailCacheSize) {
          const oldest = thumbnails.keys().next().value;
          if (oldest !== undefined) {
            thumbnails.delete(oldest);
            rows.current.get(oldest)?.update(undefined);
          }
        }
        rows.current.get(id)?.update(src);
      }
    }

    void render().catch(() => undefined);
    return () => controller.abort();
  }, [loadImage, nearby, open, pixels, select, shaderSources, source]);

  return observe;
}

function waitForIdle(signal: AbortSignal) {
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
