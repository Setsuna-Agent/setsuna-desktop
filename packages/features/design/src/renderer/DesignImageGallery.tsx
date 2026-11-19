import { Check, ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LoadDesignImage } from './design-images.js';

export function useProjectImagePreview(path: string | undefined, loadImage: LoadDesignImage) {
  const [result, setResult] = useState<{ path: string; src: string | null }>();
  useEffect(() => {
    if (!path) return;
    let active = true;
    void loadImage(path).then((image) => {
      if (active) setResult({ path, src: image.src });
    }).catch(() => {
      if (active) setResult({ path, src: null });
    });
    return () => { active = false; };
  }, [loadImage, path]);
  return result && result.path === path ? result.src : undefined;
}

export function DesignImageGallery({ paths, selected, loadImage, onSelect, disabled, searching, label }: Readonly<{
  paths: readonly string[];
  selected?: string;
  loadImage: LoadDesignImage;
  onSelect(path: string): void;
  disabled: boolean;
  searching: boolean;
  label: string;
}>) {
  const gallery = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set());
  const canObserve = typeof IntersectionObserver !== 'undefined';

  useEffect(() => {
    const root = gallery.current;
    if (!root || !canObserve) return;
    // Each project preview can contain a full-size image. Load only the thumbnails in view.
    const observer = new IntersectionObserver((entries) => {
      setVisible((current) => {
        const next = new Set(current);
        for (const entry of entries) {
          const path = (entry.target as HTMLElement).dataset.assetPath;
          if (!path) continue;
          if (entry.isIntersecting) next.add(path);
          else next.delete(path);
        }
        return next;
      });
    }, { root, rootMargin: '32px' });
    root.querySelectorAll('[data-asset-path]').forEach((tile) => observer.observe(tile));
    return () => observer.disconnect();
  }, [canObserve, paths]);

  return <div className="design-image-picker__gallery" ref={gallery} role="group" aria-label={label} aria-busy={searching}>
    {paths.map((path) => <button key={path} type="button" className="design-image-picker__tile" title={path}
      aria-label={path} aria-pressed={selected === path} disabled={disabled} data-asset-path={path} onClick={() => onSelect(path)}>
      <span className="design-image-picker__thumbnail">
        {!canObserve || visible.has(path) || selected === path ? <Thumbnail path={path} loadImage={loadImage} /> : <ImageIcon size={18} aria-hidden="true" />}
        {selected === path ? <span className="design-image-picker__selected"><Check size={12} aria-hidden="true" /></span> : null}
      </span>
      <span className="design-image-picker__file-name">{path.split('/').at(-1)}</span>
    </button>)}
  </div>;
}

function Thumbnail({ path, loadImage }: Readonly<{ path: string; loadImage: LoadDesignImage }>) {
  const src = useProjectImagePreview(path, loadImage);
  return src ? <img src={src} alt="" decoding="async" draggable={false} /> : <ImageIcon size={18} aria-hidden="true" />;
}
