import { normalizeBrowserBookmarkUrl } from '../../contracts/bookmark-tree.js';

export const BROWSER_PINNED_PAGES_KEY = 'setsuna.desktop.browser.pinned-pages.v1';
export const BROWSER_PINNED_PAGES_CHANGED = 'setsuna:browser-pinned-pages-changed';
export type BrowserPinnedPage = Readonly<{ title: string; url: string }>;
type PageStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readBrowserPinnedPages(storage: PageStorage | null = pageStorage()): BrowserPinnedPage[] {
  if (!storage) return [];
  const raw = storage.getItem(BROWSER_PINNED_PAGES_KEY);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Invalid pinned pages.');
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const page = normalizePage(entry);
    if (!page) throw new Error('Invalid pinned page.');
    if (seen.has(page.url)) return [];
    seen.add(page.url);
    return [page];
  });
}

export function toggleBrowserPinnedPage(input: BrowserPinnedPage, storage: PageStorage | null = pageStorage()): void {
  const page = normalizePage(input);
  if (!page || !storage) throw new Error('Pinned page unavailable.');
  // Read before writing so mounted panels preserve each other's pins; corrupt data is never overwritten.
  const current = readBrowserPinnedPages(storage);
  const next = current.some((entry) => entry.url === page.url)
    ? current.filter((entry) => entry.url !== page.url) : [...current, page];
  storage.setItem(BROWSER_PINNED_PAGES_KEY, JSON.stringify(next));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BROWSER_PINNED_PAGES_CHANGED));
}

function normalizePage(value: unknown): BrowserPinnedPage | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Partial<BrowserPinnedPage>;
  const url = normalizeBrowserBookmarkUrl(page.url);
  if (!url) return null;
  const title = typeof page.title === 'string' ? page.title.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  return { url, title: title || new URL(url).hostname };
}

function pageStorage(): PageStorage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}
