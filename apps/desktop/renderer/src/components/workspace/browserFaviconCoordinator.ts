const maxBrowserFaviconCandidateCharacters = 512_000;
const maxBrowserFaviconCandidateCount = 8;
const maxBrowserFaviconNetworkUrlLength = 8_192;
const browserFaviconFallbackDelayMs = 250;

type BrowserFaviconScheduler = {
  cancel(handle: ReturnType<typeof setTimeout>): void;
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
};

export type BrowserFaviconCoordinator = {
  dispose(): void;
  faviconUpdated(candidates: readonly string[]): void;
  loadingStopped(): void;
  navigationStarted(): void;
};

export function createBrowserFaviconCoordinator({
  onChange,
  resolve,
  scheduler = defaultBrowserFaviconScheduler,
}: {
  onChange: (faviconUrl: string | null) => void;
  resolve: (candidates: readonly string[]) => Promise<string | null>;
  scheduler?: BrowserFaviconScheduler;
}): BrowserFaviconCoordinator {
  let disposed = false;
  let faviconEventSeen = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let navigationRevision = 0;
  let requestRevision = 0;
  let resolvedForNavigation = false;

  const clearFallbackTimer = () => {
    if (fallbackTimer === null) return;
    scheduler.cancel(fallbackTimer);
    fallbackTimer = null;
  };

  const requestFavicon = (candidates: readonly string[]) => {
    const expectedNavigationRevision = navigationRevision;
    const expectedRequestRevision = ++requestRevision;
    void Promise.resolve()
      .then(() => resolve(candidates))
      .then((faviconUrl) => {
        if (
          disposed
          || navigationRevision !== expectedNavigationRevision
          || requestRevision !== expectedRequestRevision
        ) return;
        if (faviconUrl) {
          resolvedForNavigation = true;
          onChange(faviconUrl);
        } else if (!resolvedForNavigation) {
          onChange(null);
        }
      })
      .catch(() => {
        if (
          !disposed
          && navigationRevision === expectedNavigationRevision
          && requestRevision === expectedRequestRevision
          && !resolvedForNavigation
        ) onChange(null);
      });
  };

  return {
    dispose() {
      disposed = true;
      requestRevision += 1;
      clearFallbackTimer();
    },
    faviconUpdated(candidates) {
      faviconEventSeen = true;
      clearFallbackTimer();
      requestFavicon(candidates);
    },
    loadingStopped() {
      if (faviconEventSeen || fallbackTimer !== null) return;
      const expectedNavigationRevision = navigationRevision;
      fallbackTimer = scheduler.schedule(() => {
        fallbackTimer = null;
        if (disposed || navigationRevision !== expectedNavigationRevision || faviconEventSeen) return;
        requestFavicon([]);
      }, browserFaviconFallbackDelayMs);
    },
    navigationStarted() {
      navigationRevision += 1;
      requestRevision += 1;
      faviconEventSeen = false;
      resolvedForNavigation = false;
      clearFallbackTimer();
    },
  };
}

export function resolveBrowserFaviconUrls(favicons: readonly string[]): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  let acceptedCharacters = 0;

  for (const favicon of favicons) {
    if (resolved.length >= maxBrowserFaviconCandidateCount) break;
    const candidate = favicon.trim();
    if (!candidate || acceptedCharacters + candidate.length > maxBrowserFaviconCandidateCharacters) continue;

    let normalized: string | null = null;
    if (/^data:image\//i.test(candidate)) {
      normalized = candidate;
    } else if (candidate.length <= maxBrowserFaviconNetworkUrlLength) {
      try {
        const url = new URL(candidate);
        if (url.protocol === 'https:' || url.protocol === 'http:') normalized = url.href;
      } catch {
        // Ignore malformed and unsupported favicon URLs from untrusted pages.
      }
    }
    if (!normalized || seen.has(normalized)) continue;

    acceptedCharacters += candidate.length;
    seen.add(normalized);
    resolved.push(normalized);
  }
  return resolved;
}

export function resolveBrowserFaviconUrl(favicons: readonly string[]): string | null {
  return resolveBrowserFaviconUrls(favicons)[0] ?? null;
}

const defaultBrowserFaviconScheduler: BrowserFaviconScheduler = {
  cancel: (handle) => clearTimeout(handle),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
};
