import { describe, expect, it } from 'vitest';
import { browserAddressSuggestions } from '../../../src/renderer/address-bar/browserAddressCandidates.js';

const history = [
  { title: '模型管理', url: 'http://localhost:5173/console/models', visitedAt: 300 },
  { title: 'localhost', url: 'http://localhost:5173/', visitedAt: 200 },
  { title: '文档', url: 'https://example.com/%E6%A8%A1%E5%9E%8B', visitedAt: 100 },
];

describe('browser address suggestions', () => {
  it('offers an exact history visit, explicit URL search, and related pages without duplicating the visit', () => {
    expect(browserAddressSuggestions('localhost:5173', history)).toEqual([
      { kind: 'history', id: 'history:http://localhost:5173/', title: 'localhost', url: 'http://localhost:5173/' },
      { kind: 'search', id: 'search:localhost:5173', title: 'localhost:5173', url: 'https://www.bing.com/search?q=localhost%3A5173' },
      { kind: 'history', id: 'history:http://localhost:5173/console/models', title: '模型管理', url: 'http://localhost:5173/console/models' },
    ]);
  });

  it('matches titles and decoded paths while treating non-web input as a search', () => {
    expect(browserAddressSuggestions('模型', history).map((item) => item.url)).toEqual([
      'https://www.bing.com/search?q=%E6%A8%A1%E5%9E%8B',
      history[0].url,
      history[2].url,
    ]);
    expect(browserAddressSuggestions('LOCALHOST models', history).slice(1).map((item) => item.url)).toEqual([history[0].url]);
    expect(browserAddressSuggestions('javascript:alert(1)', history)[0]).toMatchObject({
      kind: 'search', url: 'https://www.bing.com/search?q=javascript%3Aalert(1)',
    });
  });

  it('finds unvisited favorites by title or decoded URL before related history', () => {
    const bookmarks = [
      { id: 'saved-models', title: '模型手册', url: 'https://docs.example.org/reference', savedAt: 300 },
      { id: 'saved-path', title: '文档', url: 'https://docs.example.org/%E6%A8%A1%E5%9E%8B', savedAt: 200 },
    ];
    expect(browserAddressSuggestions('模型', history, bookmarks).slice(1)).toMatchObject([
      { kind: 'bookmark', url: bookmarks[0].url },
      { kind: 'bookmark', url: bookmarks[1].url },
      { kind: 'history', url: history[0].url },
      { kind: 'history', url: history[2].url },
    ]);
    expect(browserAddressSuggestions('DOCS.EXAMPLE 模型', [], bookmarks).slice(1)).toMatchObject([
      { kind: 'bookmark', url: bookmarks[0].url },
      { kind: 'bookmark', url: bookmarks[1].url },
    ]);
  });

  it('merges repeated favorite URLs while keeping every saved name and visited title searchable', () => {
    const bookmarks = [
      { id: 'work', title: '工作后台', url: history[0].url, savedAt: 200 },
      { id: 'personal', title: '常用站点', url: history[0].url, savedAt: 100 },
    ];
    for (const query of ['工作', '常用', '模型', 'LOCALHOST models']) {
      const matches = browserAddressSuggestions(query, [history[0]], bookmarks).slice(1);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ kind: 'bookmark', url: history[0].url });
    }
    expect(browserAddressSuggestions('常用', history, bookmarks)[1].title).toBe('常用站点');
  });

  it('uses an exact favorite for direct navigation without duplicating it or changing web search', () => {
    const bookmark = { id: 'local', title: '本地首页', url: history[1].url, savedAt: 100 };
    expect(browserAddressSuggestions('localhost:5173', history, [bookmark], 'google')).toEqual([
      { kind: 'bookmark', id: `bookmark:${bookmark.url}`, title: bookmark.title, url: bookmark.url },
      { kind: 'search', id: 'search:localhost:5173', title: 'localhost:5173', url: 'https://www.google.com/search?q=localhost%3A5173' },
      { kind: 'history', id: `history:${history[0].url}`, title: history[0].title, url: history[0].url },
    ]);
  });

  it('shows bounded recent history on an empty input and still offers navigation without a history match', () => {
    const recent = Array.from({ length: 20 }, (_, index) => ({ title: `Page ${index}`, url: `https://example.com/${index}`, visitedAt: 100 - index }));
    const bookmarks = recent.map((entry, index) => ({ id: `saved-${index}`, title: entry.title, url: entry.url, savedAt: 100 - index }));
    expect(browserAddressSuggestions('', recent).map((item) => item.url)).toEqual(recent.slice(0, 8).map((item) => item.url));
    expect(browserAddressSuggestions('', [recent[2]], bookmarks).map((item) => item.url)).toEqual([
      recent[2].url, recent[0].url, recent[1].url, ...recent.slice(3, 8).map((item) => item.url),
    ]);
    expect(browserAddressSuggestions('', [], bookmarks).map((item) => item.url)).toEqual(recent.slice(0, 8).map((item) => item.url));
    expect(browserAddressSuggestions('example.org', recent)[0]).toMatchObject({ kind: 'navigate', url: 'https://example.org' });
  });
});
