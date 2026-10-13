import { expect, it } from 'vitest';
import { isRuntimeThreadReference, parseThreadMentions, threadMentionText } from '../../src/threads/reference.js';

it('round-trips conversation identity and exact offsets without letting titles change the link', () => {
  const thread = { id: 'thread_0123-abc.1', title: '修复 [滚动]\\\n体验 😀' };
  const token = threadMentionText(thread);
  const content = `请结合 😀 ${token} 和 ${threadMentionText({ id: 'second', title: '方案' })} 回答`;
  const mentions = parseThreadMentions(content);
  expect(mentions.map((mention) => mention.thread.id)).toEqual([thread.id, 'second']);
  expect(mentions[0].thread.title).toBe('修复  滚动   体验 😀');
  expect(content.slice(mentions[0].start, mentions[0].end)).toBe(token);
  expect(thread.title).toBe('修复 [滚动]\\\n体验 😀');
});

it('bounds titles and rejects malformed references instead of treating pasted paths as thread IDs', () => {
  expect(parseThreadMentions(threadMentionText({ id: 'a', title: '长'.repeat(1000) }))[0].thread.title).toHaveLength(200);
  expect(parseThreadMentions(threadMentionText({ id: 'a', title: ' \n' }))[0].thread.title).toBe('a');
  for (const id of ['../other', 'a/b', 'a?query', 'a#hash', 'a%2fb', '', 'a'.repeat(193)]) {
    expect(isRuntimeThreadReference({ id, title: 'title' })).toBe(false);
    expect(parseThreadMentions(`[@title](thread://${id})`)).toEqual([]);
  }
  expect(parseThreadMentions('[@broken\nlabel](thread://a) [@file](file://a) @普通正文')).toEqual([]);
  expect(isRuntimeThreadReference({ id: 'valid', title: null })).toBe(false);
});
