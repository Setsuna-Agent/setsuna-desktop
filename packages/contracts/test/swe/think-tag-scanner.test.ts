import { describe, expect, it } from 'vitest';
import {
  thinkTagMatches,
  visibleTextOutsideThinkTags,
} from '../../src/swe/think-tag-scanner.js';

describe('thinkTagMatches', () => {
  it('finds raw and escaped tags without changing their historical syntax', () => {
    const text = 'before<THINK role="analysis">inside</think>middle&lt;think&gt;escaped&lt;/THINK data-x="1"&gt;after';

    expect([...thinkTagMatches(text)]).toEqual([
      { closing: false, index: 6, end: 29 },
      { closing: true, index: 35, end: 43 },
      { closing: false, index: 49, end: 62 },
      { closing: true, index: 69, end: 94 },
    ]);
  });

  it('ignores incomplete tags in adversarial model output in linear time', () => {
    const text = `${'<think '.repeat(20_000)}&lt;think&gt;content&lt;/think&gt;`;

    expect([...thinkTagMatches(text)]).toEqual([
      { closing: false, index: 140_000, end: 140_013 },
      { closing: true, index: 140_020, end: 140_034 },
    ]);
  });

  it('keeps visible text while hiding closed and unterminated thinking blocks', () => {
    expect(visibleTextOutsideThinkTags('before<think>private</think>after')).toBe('beforeafter');
    expect(visibleTextOutsideThinkTags('before&lt;think&gt;private')).toBe('before');
    expect(visibleTextOutsideThinkTags('plain answer')).toBe('plain answer');
  });

  it('does not expose reasoning after a nested think-tag example', () => {
    const content = '<think>analyze "before<think>private</think>after" and continue reasoning</think>answer';

    expect(visibleTextOutsideThinkTags(content)).toBe('answer');
  });

  it('ignores protocol examples inside Markdown code when finding the real legacy boundary', () => {
    const content = '<think>explain `</think>` and continue private reasoning</think>answer';

    expect(visibleTextOutsideThinkTags(content)).toBe('answer');
  });

  it('does not truncate a visible answer that discusses think tags as code', () => {
    const content = '审查范围主要是将 `<think>` 标签迁移为 `streamParts`。';

    expect(visibleTextOutsideThinkTags(content)).toBe(content);
    expect([...thinkTagMatches(content)]).toEqual([]);
  });

  it('preserves visible text between separate legacy thinking blocks', () => {
    const content = '<think>r1</think>正文<think>r2</think>结尾';

    expect(visibleTextOutsideThinkTags(content)).toBe('正文结尾');
  });

  it('uses the outer privacy boundary when legacy reasoning contains an ambiguous closing tag', () => {
    const content = '<think>private example a</think>b then standalone </think> and more reasoning</think>answer';

    expect(visibleTextOutsideThinkTags(content)).toBe('answer');
  });

  it('does not treat tag examples in valid Markdown fences as legacy control tags', () => {
    const examples = [
      '示例：\n```html\n<think>visible example</think>\n````\n完成。',
      '示例：\n~~~html\n<think>visible example</think>\n~~~\n完成。',
      '示例：\n> ```html\n> <think>visible example</think>\n> ```\n完成。',
      '示例：\n- ~~~html\n  <think>visible example</think>\n  ~~~\n完成。',
    ];

    for (const content of examples) {
      expect(visibleTextOutsideThinkTags(content)).toBe(content);
    }
  });

  it('does not let an unclosed container fence conceal a legacy privacy boundary', () => {
    const content = '> ```html\n<think>private reasoning';

    expect(visibleTextOutsideThinkTags(content)).toBe('> ```html\n');
  });

  it('preserves tags in valid indented code blocks without trusting paragraph indentation', () => {
    const examples = [
      '示例：\n\n    <think>visible example</think>\n\n完成。',
      '示例：\n\n\t&lt;think&gt;visible example&lt;/think&gt;\n\n完成。',
      '示例：\n\n>     <think>visible quote example</think>\n\n完成。',
      '示例：\n\n-     <think>visible list example</think>\n\n完成。',
      '示例：\n\n> -     <think>visible nested example</think>\n\n完成。',
    ];

    for (const content of examples) {
      expect(visibleTextOutsideThinkTags(content)).toBe(content);
    }
    expect(visibleTextOutsideThinkTags('可见段落\n    <think>private reasoning')).toBe('可见段落\n    ');
    expect(visibleTextOutsideThinkTags('> 可见段落\n>     <think>private reasoning')).toBe('> 可见段落\n>     ');
  });
});
