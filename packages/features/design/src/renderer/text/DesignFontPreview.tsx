import { useContext, useEffect, useRef, type ReactNode } from 'react';
import type { DesignCustomFont } from '../../contracts/design-fonts.js';
import { designFontStack } from './design-typography.js';
import { DesignFontsContext } from './use-design-fonts.js';

export function designFontPreviewWeight(font: DesignCustomFont): number {
  return Math.min(font.maxWeight, Math.max(font.minWeight, 400));
}

export function DesignFontPreview({ family, name, face }: Readonly<{ family: string; name: string; face?: DesignCustomFont }>) {
  return <span title={name} data-font-preview={face?.id} style={{ fontFamily: designFontStack(family),
    fontStyle: face?.style, fontWeight: face && designFontPreviewWeight(face) }}>{name}</span>;
}

export function DesignFontPreviewList({ fonts, label, children }: Readonly<{
  fonts: readonly DesignCustomFont[]; label?: string; children: ReactNode;
}>) {
  const loadPreview = useContext(DesignFontsContext)?.loadPreview;
  const list = useRef<HTMLDivElement>(null);
  const queue = useRef(new Map<string, () => Promise<boolean>>());
  const loading = useRef(false);
  useEffect(() => {
    const root = list.current;
    if (!root || !loadPreview || !fonts.length || typeof IntersectionObserver !== 'function') return;
    const faces = new Map(fonts.map((font) => [font.id, font]));
    const queued = queue.current;
    let observing = true;

    const loadVisible = async () => {
      if (loading.current) return;
      loading.current = true;
      try {
        // Decode one face at a time. The queue survives query changes, but offscreen rows are dropped.
        for (const [id, load] of queued) {
          queued.delete(id);
          await load();
        }
      } finally { loading.current = false; }
    };

    const observer = new IntersectionObserver((entries) => {
      if (!observing) return;
      for (const entry of entries) {
        const face = faces.get((entry.target as HTMLElement).dataset.fontPreview ?? '');
        if (!face) continue;
        if (entry.isIntersecting) queued.set(face.id, () => loadPreview(face));
        else queued.delete(face.id);
      }
      void loadVisible();
    }, { root });
    root.querySelectorAll('[data-font-preview]').forEach((row) => observer.observe(row));
    return () => {
      observing = false;
      queued.clear();
      observer.disconnect();
    };
  }, [fonts, loadPreview]);

  return <div ref={list} className="design-inspector-picker__options design-panel-scroll"
    role={label ? 'list' : undefined} aria-label={label}>{children}</div>;
}
