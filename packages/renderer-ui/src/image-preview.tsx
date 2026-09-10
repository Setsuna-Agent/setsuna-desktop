import { Dialog as Primitive } from 'radix-ui';
import { ChevronLeft, ChevronRight, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { IconButton } from './button.js';
import { overlayContainer } from './portal.js';
import { useUiLabels } from './locale.js';
import { cn } from './utils.js';

type PreviewImage = { id: string; src: string; alt: string };
type Gallery = { register(image: PreviewImage): () => void; show(id: string): void };
const GalleryContext = createContext<Gallery | null>(null);

export function ImagePreviewGroup({ children }: { children: ReactNode }) {
  const images = useRef(new Map<string, PreviewImage>());
  const [preview, setPreview] = useState<{ images: PreviewImage[]; index: number } | null>(null);
  const register = useCallback((image: PreviewImage) => {
    images.current.set(image.id, image);
    return () => { images.current.delete(image.id); };
  }, []);
  const show = useCallback((id: string) => {
    const entries = [...images.current.values()];
    const index = entries.findIndex((entry) => entry.id === id);
    if (index >= 0) setPreview({ images: entries, index });
  }, []);
  const gallery = useMemo(() => ({ register, show }), [register, show]);
  return <GalleryContext.Provider value={gallery}>{children}{preview ? <ImageViewer {...preview} onClose={() => setPreview(null)} /> : null}</GalleryContext.Provider>;
}

export function ImagePreview({ src = '', alt = '', className, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const labels = useUiLabels();
  const gallery = useContext(GalleryContext);
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => gallery?.register({ id, src, alt }), [gallery, id, src, alt]);
  return <>
    <button type="button" className="sd-image" aria-label={alt || labels.preview} onClick={() => gallery ? gallery.show(id) : setOpen(true)}>
      <img {...props} src={src} alt={alt} className={cn('sd-image__content', className)} />
    </button>
    {open ? <ImageViewer images={[{ id, src, alt }]} index={0} onClose={() => setOpen(false)} /> : null}
  </>;
}

function ImageViewer({ images, index: initialIndex, onClose }: { images: PreviewImage[]; index: number; onClose(): void }) {
  const labels = useUiLabels();
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const focus = useRef(document.activeElement as HTMLElement | null);
  const current = images[index];
  const changeImage = (next: number) => { setIndex(next); setScale(1); setRotation(0); };
  return <Primitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Primitive.Portal container={overlayContainer()}>
      <Primitive.Overlay className="sd-image-viewer__overlay" />
      <Primitive.Content className="sd-image-viewer" aria-describedby={undefined} onCloseAutoFocus={(event) => { event.preventDefault(); focus.current?.focus({ preventScroll: true }); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && index > 0) changeImage(index - 1);
          if (event.key === 'ArrowRight' && index < images.length - 1) changeImage(index + 1);
        }}>
        <Primitive.Title className="sd-image-viewer__title">{current.alt || labels.preview}</Primitive.Title>
        <Primitive.Close asChild><IconButton className="sd-image-viewer__close" label={labels.close}><X size={20} /></IconButton></Primitive.Close>
        <div className="sd-image-viewer__canvas" onWheel={(event) => setScale((value) => Math.min(5, Math.max(0.25, value + (event.deltaY < 0 ? 0.1 : -0.1))))}>
          <img src={current.src} alt={current.alt} style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }} draggable={false} />
        </div>
        <div className="sd-image-viewer__toolbar">
          <IconButton label={labels.previous} disabled={index === 0} onClick={() => changeImage(index - 1)}><ChevronLeft size={18} /></IconButton>
          <span>{index + 1} / {images.length}</span>
          <IconButton label={labels.next} disabled={index === images.length - 1} onClick={() => changeImage(index + 1)}><ChevronRight size={18} /></IconButton>
          <IconButton label={labels.zoomOut} disabled={scale <= 0.25} onClick={() => setScale(Math.max(0.25, scale - 0.25))}><ZoomOut size={18} /></IconButton>
          <IconButton label={labels.zoomIn} disabled={scale >= 5} onClick={() => setScale(Math.min(5, scale + 0.25))}><ZoomIn size={18} /></IconButton>
          <IconButton label={labels.rotate} onClick={() => setRotation(rotation + 90)}><RotateCw size={18} /></IconButton>
        </div>
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>;
}
