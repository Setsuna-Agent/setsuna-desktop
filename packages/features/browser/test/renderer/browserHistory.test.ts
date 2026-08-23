import { describe, expect, it } from 'vitest';
import {
  isBrowserBookmarked,
  toggleBrowserBookmark,
} from '../../src/renderer/browserBookmarks.js';
import {
  BROWSER_HISTORY_STORAGE_KEY,
  addBrowserHistoryVisit,
  readBrowserHistory,
  writeBrowserHistory,
  type BrowserHistoryEntry,
} from '../../src/renderer/browserHistory.js';

describe('browser history', () => {
  it('keeps the latest visit per web URL and rejects internal pages', () => {
    const firstVisit = addBrowserHistoryVisit([], {
      title: 'Example',
      url: 'https://example.com/docs',
      visitedAt: 100,
    });
    const updatedVisit = addBrowserHistoryVisit(firstVisit, {
      title: '  Example   documentation  ',
      url: 'https://example.com/docs',
      visitedAt: 200,
    });
    const withInternalPage = addBrowserHistoryVisit(updatedVisit, {
      title: 'New tab',
      url: 'about:blank',
      visitedAt: 300,
    });

    expect(withInternalPage).toEqual([{
      title: 'Example documentation',
      url: 'https://example.com/docs',
      visitedAt: 200,
    }]);
  });

  it('persists a bounded, recoverable history projection', () => {
    const storage = new MemoryStorage();
    const entries: BrowserHistoryEntry[] = Array.from({ length: 60 }, (_, index) => ({
      title: `Page ${index}`,
      url: `https://example.com/${index}`,
      visitedAt: index + 1,
    }));

    writeBrowserHistory(entries, storage);
    expect(readBrowserHistory(storage)).toHaveLength(50);
    expect(readBrowserHistory(storage)[0]?.url).toBe('https://example.com/59');

    storage.setItem(BROWSER_HISTORY_STORAGE_KEY, '{broken');
    expect(readBrowserHistory(storage)).toEqual([]);
  });
});

class MemoryStorage {
  readonly #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

describe('browser bookmarks', () => {
  it('toggles normalized web pages without accepting internal URLs', () => {
    const bookmarked = toggleBrowserBookmark([], {
      title: ' Example ',
      url: 'https://example.com',
    }, 100);

    expect(bookmarked).toEqual([{
      savedAt: 100,
      title: 'Example',
      url: 'https://example.com/',
    }]);
    expect(isBrowserBookmarked(bookmarked, 'https://example.com')).toBe(true);
    expect(toggleBrowserBookmark(bookmarked, {
      title: 'Example',
      url: 'https://example.com',
    }, 200)).toEqual([]);
    expect(toggleBrowserBookmark([], {
      title: 'New tab',
      url: 'about:blank',
    }, 300)).toEqual([]);
  });
});
