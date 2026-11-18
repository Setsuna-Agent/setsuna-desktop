import { useEffect, useState, type ReactNode } from 'react';
import type { LoadDesignImage } from '../design-images.js';
import { emptyDesignPaintImages, type DesignPaintImages } from './design-gradients.js';

export function DesignCanvasPaintImages({ paths, loadImage, children }: Readonly<{
  paths: readonly string[]; loadImage: LoadDesignImage; children(images: DesignPaintImages): ReactNode;
}>) {
  const key = JSON.stringify(paths);
  const [loaded, setLoaded] = useState<{ key: string; loadImage: LoadDesignImage; images: DesignPaintImages }>();
  useEffect(() => {
    let active = true;
    const unique = new Set<string>(JSON.parse(key) as string[]);
    void Promise.allSettled(Array.from(unique, async (path) => [path, await loadImage(path)] as const)).then((results) => {
      if (!active) return;
      const images = new Map(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
      setLoaded({ key, loadImage, images });
    });
    return () => { active = false; };
  }, [key, loadImage]);
  return children(loaded?.key === key && loaded.loadImage === loadImage ? loaded.images : emptyDesignPaintImages);
}
