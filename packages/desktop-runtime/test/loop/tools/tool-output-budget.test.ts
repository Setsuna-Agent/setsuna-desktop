import { describe, expect, it } from 'vitest';
import {
  boundToolOutput,
  estimateUtf8Tokens,
  truncationHeader,
} from '../../../src/loop/tools/tool-output-budget.js';

describe('tool output budget', () => {
  it('estimates tokens as ceil(utf8 bytes / 4)', () => {
    expect(estimateUtf8Tokens('')).toBe(0);
    expect(estimateUtf8Tokens('abcd')).toBe(1);
    expect(estimateUtf8Tokens('abcde')).toBe(2);
    // 每个中文字符 3 字节：6 字节 → ceil(6/4)=2
    expect(estimateUtf8Tokens('中文')).toBe(2);
  });

  it('leaves results within the limit untouched', () => {
    const content = 'short output';
    const bounded = boundToolOutput({ content, tokenLimit: 10_000 });
    expect(bounded).toEqual({
      content,
      originalEstimatedTokens: 3,
      visibleTokens: 3,
      truncated: false,
    });
  });

  it('keeps a head/tail summary with the envelope inside the budget', () => {
    // 每个 token 4 字节；超限内容构造为 2k token，限制 1k token。
    const content = 'x'.repeat(2_000 * 4);
    const bounded = boundToolOutput({ content, tokenLimit: 1_000, resultId: 'tool_result_1' });
    expect(bounded.truncated).toBe(true);
    expect(bounded.resultId).toBe('tool_result_1');
    expect(bounded.content).toContain('Warning: tool output was truncated.');
    expect(bounded.content).toContain('result_id: tool_result_1');
    expect(bounded.content).toContain('Use read_tool_result to read another range.\n\n');
    expect(bounded.content).toContain('... middle omitted ...');
    // 头部之后是连续的 x;尾部同样以 x 结束。
    expect(bounded.content.includes('x'.repeat(16))).toBe(true);
    expect(bounded.content.endsWith('x')).toBe(true);
    // 信封计入预算：可见 token 必须不超过限制。
    expect(bounded.visibleTokens).toBeLessThanOrEqual(1_000);
    expect(bounded.visibleTokens).toBeGreaterThan(0);
  });

  it('never splits a UTF-8 character at the head or tail boundary', () => {
    // 中文 3 字节/字。构造大量中文字符，保证裁剪点落在多字节序列中间。
    const word = '汉'.repeat(400);
    const content = `${word}\n${'a'.repeat(800)}\n${'文'.repeat(400)}`;
    const bounded = boundToolOutput({ content, tokenLimit: 120, resultId: 'tool_result_utf8' });
    expect(bounded.truncated).toBe(true);
    // 截断后的文本必须能被干净解码：不允许出现 U+FFFD 替换符。
    expect(bounded.content.includes('\uFFFD')).toBe(false);
    expect(bounded.content).toContain('汉');
    expect(bounded.content).toContain('文');
  });

  it('marks local storage clipping in the envelope', () => {
    const content = 'y'.repeat(2_000 * 4);
    const bounded = boundToolOutput({ content, tokenLimit: 1_000, resultId: 'tool_result_2', locallyTruncated: true });
    expect(bounded.content).toContain('locally_truncated: true');
  });

  it('does not promise pagination when result storage is unavailable', () => {
    const bounded = boundToolOutput({ content: 'z'.repeat(8_000), tokenLimit: 100 });

    expect(bounded.content).not.toContain('Use read_tool_result');
    expect(bounded.content).toContain('complete output is unavailable');
  });

  it('builds a header that fits the fixed overhead accounting', () => {
    const header = truncationHeader('tool_result_3', 10_000, 4_000, true);
    expect(header).toContain('original_estimated_tokens: 10000');
    expect(header).toContain('visible_token_limit: 4000');
    expect(header).toContain('locally_truncated: true');
    expect(header).toContain('Use read_tool_result to read another range.');
  });
});
