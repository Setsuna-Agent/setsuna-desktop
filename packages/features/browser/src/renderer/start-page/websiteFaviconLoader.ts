import type { BrowserDesktopBridge } from '../../contracts/index.js';

type ResolveFavicon = BrowserDesktopBridge['getWebsiteFavicon'];
export type WebsiteFaviconLoader = ReturnType<typeof createWebsiteFaviconLoader>;

/** Share site icons across sections and bound background work to three sites at a time. */
export function createWebsiteFaviconLoader(resolveFavicon: ResolveFavicon) {
  const cache = new Map<string, string | null>();
  const pending = new Map<string, Promise<string | null>>();
  const queue: Array<{ origin: string; finish(icon: string | null): void }> = [];
  let active = 0;
  let disposed = false;

  const drain = () => {
    while (!disposed && active < 3 && queue.length) {
      const job = queue.shift()!;
      active += 1;
      // Resolve only the site root: history entries may include logout or other action URLs.
      void Promise.resolve().then(() => disposed ? null : resolveFavicon(`${job.origin}/`))
        .catch(() => null).then((icon) => {
          pending.delete(job.origin);
          if (!disposed) {
            cache.set(job.origin, icon);
            if (cache.size > 64) cache.delete(cache.keys().next().value!);
          }
          job.finish(disposed ? null : icon);
          active -= 1;
          drain();
        });
    }
  };

  return {
    load(url: string): Promise<string | null> {
      if (disposed) return Promise.resolve(null);
      let origin: string;
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return Promise.resolve(null);
        origin = parsed.origin;
      } catch { return Promise.resolve(null); }
      if (cache.has(origin)) return Promise.resolve(cache.get(origin)!);
      const existing = pending.get(origin);
      if (existing) return existing;
      const request = new Promise<string | null>((finish) => { queue.push({ origin, finish }); });
      pending.set(origin, request);
      drain();
      return request;
    },
    dispose() {
      disposed = true;
      for (const job of queue.splice(0)) job.finish(null);
      pending.clear();
      cache.clear();
    },
  };
}
