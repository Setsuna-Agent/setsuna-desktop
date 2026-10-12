import { Globe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserDesktopBridge } from '../../contracts/index.js';
import { createWebsiteFaviconLoader, type WebsiteFaviconLoader } from './websiteFaviconLoader.js';

export function useWebsiteFaviconLoader(resolve?: BrowserDesktopBridge['getWebsiteFavicon']) {
  const [loader, setLoader] = useState<WebsiteFaviconLoader | null>(null);
  useEffect(() => {
    const next = resolve ? createWebsiteFaviconLoader(resolve) : null;
    setLoader(next);
    return () => next?.dispose();
  }, [resolve]);
  return loader;
}

export function BrowserQuickLinkIcon({ url, loader }: { url: string; loader: WebsiteFaviconLoader | null }) {
  const element = useRef<HTMLSpanElement>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [failedIcon, setFailedIcon] = useState<string | null>(null);

  useEffect(() => {
    setIcon(null);
    if (!loader || !element.current) return;
    let current = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loader.load(url).then((value) => { if (current) setIcon(value); });
    });
    observer.observe(element.current);
    return () => { current = false; observer.disconnect(); };
  }, [loader, url]);

  return <span ref={element} className="browser-quick-links__icon" aria-hidden="true">
    {icon && icon !== failedIcon
      ? <img src={icon} alt="" draggable={false} onError={() => setFailedIcon(icon)} />
      : <Globe size={16} />}
  </span>;
}
