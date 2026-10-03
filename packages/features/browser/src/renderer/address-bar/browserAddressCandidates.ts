import type { BrowserHistoryEntry } from '../browserHistory.js';
import { browserSearchUrl, normalizeBrowserInput } from '../browserNavigation.js';

export type BrowserAddressSuggestion = Readonly<{
  kind: 'history' | 'navigate' | 'search';
  id: string;
  title: string;
  url: string;
}>;

const maximumSuggestions = 8;

export function browserAddressSuggestions(
  value: string,
  history: readonly BrowserHistoryEntry[],
): BrowserAddressSuggestion[] {
  const query = value.trim();
  const terms = searchableText(query).split(/\s+/).filter(Boolean);
  const matches = history.filter((entry) => {
    const text = `${entry.title.toLowerCase()} ${searchableText(entry.url)}`;
    return terms.every((term) => text.includes(term));
  });
  if (!query) return matches.slice(0, maximumSuggestions).map(historySuggestion);

  const searchUrl = browserSearchUrl(query);
  const destination = normalizeBrowserInput(query);
  const suggestions: BrowserAddressSuggestion[] = [];
  if (destination !== searchUrl) {
    // URL serialization makes a bare origin match its stored trailing-slash form.
    const exact = history.find((entry) => entry.url === canonicalUrl(destination));
    suggestions.push(exact ? historySuggestion(exact) : {
      kind: 'navigate', id: `navigate:${destination}`, title: query, url: destination,
    });
  }
  suggestions.push({ kind: 'search', id: `search:${query}`, title: query, url: searchUrl });
  const primaryUrl = suggestions[0].url;
  return [
    ...suggestions,
    ...matches.filter((entry) => entry.url !== primaryUrl).map(historySuggestion),
  ].slice(0, maximumSuggestions);
}

function historySuggestion(entry: BrowserHistoryEntry): BrowserAddressSuggestion {
  return { kind: 'history', id: `history:${entry.url}`, title: entry.title, url: entry.url };
}

function canonicalUrl(value: string): string {
  try { return new URL(value).href; } catch { return value; }
}

function searchableText(value: string): string {
  let text = value;
  try { text = decodeURI(text); } catch { /* Partially typed escapes are still searchable. */ }
  return text.replace(/^https?:\/\//i, '').toLowerCase();
}
