export const BROWSER_HISTORY_STORAGE_KEY = 'setsuna.desktop.browser.history.v1';
export const BROWSER_HISTORY_CHANGED = 'setsuna:browser-history-changed';

const maxBrowserHistoryEntries = 5_000;
const maxBrowserHistoryTitleLength = 240;
const maxBrowserHistoryUrlLength = 8_192;

export type BrowserHistoryEntry = Readonly<{
  title: string;
  url: string;
  visitedAt: number;
}>;

export type BrowserHistoryVisit = Readonly<{
  title: string;
  url: string;
  visitedAt: number;
}>;

type BrowserHistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readBrowserHistory(
  storage: BrowserHistoryStorage | null = browserHistoryStorage(),
): BrowserHistoryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(BROWSER_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return normalizeBrowserHistoryEntries(value);
  } catch {
    return [];
  }
}

export function writeBrowserHistory(
  entries: readonly BrowserHistoryEntry[],
  storage: BrowserHistoryStorage | null = browserHistoryStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      BROWSER_HISTORY_STORAGE_KEY,
      JSON.stringify(normalizeBrowserHistoryEntries(entries)),
    );
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(BROWSER_HISTORY_CHANGED));
    return true;
  } catch {
    // Browsing must keep working when local storage is unavailable or full.
    return false;
  }
}

export function addBrowserHistoryVisit(
  entries: readonly BrowserHistoryEntry[],
  visit: BrowserHistoryVisit,
): BrowserHistoryEntry[] {
  return normalizeBrowserHistoryEntries([visit, ...entries]);
}

export function removeBrowserHistoryEntry(
  entries: readonly BrowserHistoryEntry[],
  rawUrl: string,
): BrowserHistoryEntry[] {
  const url = normalizeBrowserHistoryUrl(rawUrl);
  return url ? entries.filter((entry) => entry.url !== url) : [...entries];
}

function normalizeBrowserHistoryEntries(value: unknown): BrowserHistoryEntry[] {
  if (!Array.isArray(value)) return [];

  const entries = value
    .map(normalizeBrowserHistoryEntry)
    .filter((entry): entry is BrowserHistoryEntry => entry !== null)
    .sort((left, right) => right.visitedAt - left.visitedAt);
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  }).slice(0, maxBrowserHistoryEntries);
}

function normalizeBrowserHistoryEntry(value: unknown): BrowserHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BrowserHistoryEntry>;
  const url = normalizeBrowserHistoryUrl(candidate.url);
  if (
    !url
    || typeof candidate.visitedAt !== 'number'
    || !Number.isFinite(candidate.visitedAt)
    || candidate.visitedAt <= 0
    || !Number.isFinite(new Date(candidate.visitedAt).getTime())
  ) return null;

  const title = normalizeBrowserHistoryTitle(candidate.title) || new URL(url).hostname;
  return {
    title,
    url,
    visitedAt: Math.trunc(candidate.visitedAt),
  };
}

function normalizeBrowserHistoryUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > maxBrowserHistoryUrlLength) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeBrowserHistoryTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxBrowserHistoryTitleLength);
}

function browserHistoryStorage(): BrowserHistoryStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
