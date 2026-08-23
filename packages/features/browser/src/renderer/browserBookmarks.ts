export const BROWSER_BOOKMARKS_STORAGE_KEY = 'setsuna.desktop.browser.bookmarks.v1';

const maxBrowserBookmarks = 50;
const maxBrowserBookmarkTitleLength = 240;
const maxBrowserBookmarkUrlLength = 8_192;

export type BrowserBookmarkEntry = Readonly<{
  savedAt: number;
  title: string;
  url: string;
}>;

export type BrowserBookmarkInput = Readonly<{
  title: string;
  url: string;
}>;

type BrowserBookmarkStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readBrowserBookmarks(
  storage: BrowserBookmarkStorage | null = browserBookmarkStorage(),
): BrowserBookmarkEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(BROWSER_BOOKMARKS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeBrowserBookmarks(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeBrowserBookmarks(
  entries: readonly BrowserBookmarkEntry[],
  storage: BrowserBookmarkStorage | null = browserBookmarkStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      BROWSER_BOOKMARKS_STORAGE_KEY,
      JSON.stringify(normalizeBrowserBookmarks(entries)),
    );
  } catch {
    // Bookmarking must not interrupt browsing when persistence is unavailable.
  }
}

export function toggleBrowserBookmark(
  entries: readonly BrowserBookmarkEntry[],
  input: BrowserBookmarkInput,
  savedAt = Date.now(),
): BrowserBookmarkEntry[] {
  const bookmark = normalizeBrowserBookmark({ ...input, savedAt });
  if (!bookmark) return [...entries];
  if (entries.some((entry) => entry.url === bookmark.url)) {
    return entries.filter((entry) => entry.url !== bookmark.url);
  }
  return normalizeBrowserBookmarks([bookmark, ...entries]);
}

export function isBrowserBookmarked(
  entries: readonly BrowserBookmarkEntry[],
  rawUrl: string,
): boolean {
  const url = normalizeBrowserBookmarkUrl(rawUrl);
  return Boolean(url && entries.some((entry) => entry.url === url));
}

function normalizeBrowserBookmarks(value: unknown): BrowserBookmarkEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .map(normalizeBrowserBookmark)
    .filter((entry): entry is BrowserBookmarkEntry => entry !== null)
    .sort((left, right) => right.savedAt - left.savedAt);
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  }).slice(0, maxBrowserBookmarks);
}

function normalizeBrowserBookmark(value: unknown): BrowserBookmarkEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BrowserBookmarkEntry>;
  const url = normalizeBrowserBookmarkUrl(candidate.url);
  if (
    !url
    || typeof candidate.savedAt !== 'number'
    || !Number.isFinite(candidate.savedAt)
    || candidate.savedAt <= 0
  ) return null;

  const title = normalizeBrowserBookmarkTitle(candidate.title) || new URL(url).hostname;
  return { savedAt: Math.trunc(candidate.savedAt), title, url };
}

function normalizeBrowserBookmarkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > maxBrowserBookmarkUrlLength) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeBrowserBookmarkTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxBrowserBookmarkTitleLength);
}

function browserBookmarkStorage(): BrowserBookmarkStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
