import type { BrowserBookmarkEntry } from '../browserBookmarks.js';
import type { BrowserHistoryEntry } from '../browserHistory.js';
import type { BrowserSearchEngine } from '../../contracts/settings.js';
import { browserSearchUrl, normalizeBrowserInput } from '../browserNavigation.js';

export type BrowserAddressSuggestion = Readonly<{
  kind: 'bookmark' | 'history' | 'navigate' | 'search';
  id: string;
  title: string;
  url: string;
}>;

const maximumSuggestions = 8;

export function browserAddressSuggestions(
  value: string,
  history: readonly BrowserHistoryEntry[],
  bookmarks: readonly BrowserBookmarkEntry[] = [],
  searchEngine: BrowserSearchEngine = 'bing',
): BrowserAddressSuggestion[] {
  const query = value.trim();
  const terms = searchableText(query).split(/\s+/).filter(Boolean);
  const matchesQuery = (entry: BrowserHistoryEntry | BrowserBookmarkEntry) => {
    const text = `${entry.title.toLowerCase()} ${searchableText(entry.url)}`;
    return terms.every((term) => text.includes(term));
  };
  const bookmarksByUrl = new Map<string, BrowserBookmarkEntry>();
  for (const entry of bookmarks) {
    if (!bookmarksByUrl.has(entry.url)) bookmarksByUrl.set(entry.url, entry);
  }
  // Match each source before merging so custom bookmark names and visited titles remain searchable.
  const bookmarkMatches = bookmarks.filter(matchesQuery).map(bookmarkSuggestion);
  const historyMatches = history.filter(matchesQuery).map((entry) => {
    const bookmark = bookmarksByUrl.get(entry.url);
    return bookmark ? bookmarkSuggestion(bookmark) : historySuggestion(entry);
  });
  if (!query) return uniqueSuggestions([...historyMatches, ...bookmarkMatches]);

  const searchUrl = browserSearchUrl(query, searchEngine);
  const destination = normalizeBrowserInput(query, searchEngine);
  const suggestions: BrowserAddressSuggestion[] = [];
  if (destination !== searchUrl) {
    // URL serialization makes a bare origin match its stored trailing-slash form.
    const destinationUrl = canonicalUrl(destination);
    const bookmark = bookmarksByUrl.get(destinationUrl);
    const exact = history.find((entry) => entry.url === destinationUrl);
    suggestions.push(bookmark ? bookmarkSuggestion(bookmark) : exact ? historySuggestion(exact) : {
      kind: 'navigate', id: `navigate:${destination}`, title: query, url: destination,
    });
  }
  suggestions.push({ kind: 'search', id: `search:${query}`, title: query, url: searchUrl });
  return uniqueSuggestions([...suggestions, ...bookmarkMatches, ...historyMatches]);
}

function bookmarkSuggestion(entry: BrowserBookmarkEntry): BrowserAddressSuggestion {
  return { kind: 'bookmark', id: `bookmark:${entry.url}`, title: entry.title, url: entry.url };
}

function historySuggestion(entry: BrowserHistoryEntry): BrowserAddressSuggestion {
  return { kind: 'history', id: `history:${entry.url}`, title: entry.title, url: entry.url };
}

function uniqueSuggestions(suggestions: readonly BrowserAddressSuggestion[]): BrowserAddressSuggestion[] {
  const seen = new Set<string>();
  const result: BrowserAddressSuggestion[] = [];
  for (const suggestion of suggestions) {
    const url = canonicalUrl(suggestion.url);
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(suggestion);
    if (result.length === maximumSuggestions) break;
  }
  return result;
}

function canonicalUrl(value: string): string {
  try { return new URL(value).href; } catch { return value; }
}

function searchableText(value: string): string {
  let text = value;
  try { text = decodeURI(text); } catch { /* Partially typed escapes are still searchable. */ }
  return text.replace(/^https?:\/\//i, '').toLowerCase();
}
