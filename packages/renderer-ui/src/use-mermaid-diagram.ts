import { useEffect, useState } from 'react';
import { renderMermaidDiagram } from './mermaid-renderer.js';
import type { MermaidTheme } from './mermaid-theme.js';

export function useMermaidDiagram(code: string): string | null {
  const [image, setImage] = useState<{ code: string; src: string } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;

    const scheduleRender = () => {
      request?.abort();
      clearTimeout(timer);
      const controller = new AbortController();
      request = controller;
      const theme: MermaidTheme = root.dataset.theme === 'dark'
        || (!root.dataset.theme && media.matches) ? 'dark' : 'light';
      // Coalesce streamed tokens; cancelled queue entries never start a layout pass.
      timer = setTimeout(() => {
        void renderMermaidDiagram(code, theme, controller.signal).then((src) => {
          if (!controller.signal.aborted) setImage(src ? { code, src } : null);
        }).catch(() => {
          if (!controller.signal.aborted) setImage(null);
        });
      }, 200);
    };

    const observer = new MutationObserver(scheduleRender);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    media.addEventListener('change', scheduleRender);
    scheduleRender();
    return () => {
      request?.abort();
      clearTimeout(timer);
      observer.disconnect();
      media.removeEventListener('change', scheduleRender);
    };
  }, [code]);

  return image?.code === code ? image.src : null;
}
