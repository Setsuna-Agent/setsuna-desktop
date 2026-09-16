import { useEffect, useRef } from 'react';

/** 后台页签保留最后一次可见尺寸，避免面板槽关闭或切换后截图视口归零。 */
export function useBrowserBackgroundViewport(hidden: boolean) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || hidden) return;

    const rememberSize = () => {
      const { width, height } = panel.getBoundingClientRect();
      if (width > 0 && height > 0) {
        panel.style.setProperty('--desktop-browser-background-width', `${width}px`);
        panel.style.setProperty('--desktop-browser-background-height', `${height}px`);
      }
    };
    rememberSize();
    const observer = new ResizeObserver(rememberSize);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [hidden]);

  return panelRef;
}
