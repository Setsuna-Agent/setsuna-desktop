import { describe, expect, it } from 'vitest';
import { browserTabMentionText, parseBrowserTabMentions } from '../../src/contracts/tab-mention.js';

describe('browser tab mentions', () => {
  it('preserves the exact tab and URL through message serialization, including reserved URL characters', () => {
    const tab = { id: 'browser-1', title: '中文 [文档]\n导航', url: 'https://example.com/a(b)?q=中文&next=%2Fdocs#top' };
    const first = browserTabMentionText(tab);
    const second = browserTabMentionText({ ...tab, id: 'browser-2' });
    const content = `看一下 ${first} 和 ${second}，@src/index.ts`;
    const mentions = parseBrowserTabMentions(content);
    expect(mentions.map((mention) => mention.tab)).toEqual([
      { ...tab, title: '中文  文档  导航' },
      { ...tab, id: 'browser-2', title: '中文  文档  导航' },
    ]);
    expect(content.slice(mentions[0].start, mentions[0].end)).toBe(first);
    expect(content.slice(mentions[1].start, mentions[1].end)).toBe(second);
  });

  it('leaves malformed references and non-web URLs as ordinary text', () => {
    const references = [
      '[@bad](browser-tab://%zz?url=https%3A%2F%2Fexample.com)',
      '[@bad](browser-tab://tab%0A1?url=https%3A%2F%2Fexample.com)',
      ...['about:blank', 'javascript:alert(1)', 'file:///tmp/private', 'not a url'].map((url) =>
        browserTabMentionText({ id: 'tab-1', title: 'Bad', url })),
    ];
    expect(parseBrowserTabMentions(references.join('\n'))).toEqual([]);
  });
});
