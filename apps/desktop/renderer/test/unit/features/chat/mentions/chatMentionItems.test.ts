import { expect, it } from 'vitest';
import { browserTabReferences, chatMentionItems } from '../../../../../src/features/chat/mentions/chatMentionItems.js';

it('searches open web tabs by title or URL without confusing duplicate titles or workspace entries', () => {
  const tab = { title: '文档', browser: { url: 'https://example.com/guide', loading: false, faviconUrl: null } };
  const panels = [{ ...tab, id: 'first' }, { ...tab, id: 'second' },
    { ...tab, id: 'home', browser: { ...tab.browser, url: 'about:blank' } }];
  const tabs = browserTabReferences(panels);
  const file = { kind: 'file' as const, name: 'guide.md', path: 'guide.md', parent: '' };
  expect(chatMentionItems(tabs, [file], 'EXAMPLE.COM')).toEqual([
    { kind: 'browser-tab', tab: tabs[0] }, { kind: 'browser-tab', tab: tabs[1] }, { kind: 'workspace', entry: file },
  ]);
  expect(chatMentionItems(tabs, [], '文档')).toHaveLength(2);
  const updated = browserTabReferences([{ ...panels[1], title: '搜索', browser: { ...tab.browser, url: 'https://search.example.org/' } }]);
  expect(chatMentionItems(updated, [], 'guide')).toEqual([]);
  expect(chatMentionItems(updated, [], '搜索')).toEqual([{ kind: 'browser-tab', tab: updated[0] }]);
});
