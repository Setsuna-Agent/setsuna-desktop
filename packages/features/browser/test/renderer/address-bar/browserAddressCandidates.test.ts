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

  it('shows bounded recent history on an empty input and still offers navigation without a history match', () => {
    const recent = Array.from({ length: 20 }, (_, index) => ({ title: `Page ${index}`, url: `https://example.com/${index}`, visitedAt: 100 - index }));
    expect(browserAddressSuggestions('', recent).map((item) => item.url)).toEqual(recent.slice(0, 8).map((item) => item.url));
    expect(browserAddressSuggestions('example.org', recent)[0]).toMatchObject({ kind: 'navigate', url: 'https://example.org' });
  });
});
