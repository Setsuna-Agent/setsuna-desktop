import { describe, expect, it } from 'vitest';
import { explicitMemoryContentFromUserText } from '../../src/runtime/explicit-memory-content.js';

describe('explicitMemoryContentFromUserText', () => {
  it.each([
    ['请记住：这个项目用 pnpm 管理依赖。', '这个项目用 pnpm 管理依赖'],
    ['帮我保存到长期记忆，“以后使用中文回答！”', '以后使用中文回答！'],
    ['Please remember that: "Use pnpm!"', 'Use pnpm'],
    ['save this as memory, Use pnpm.', 'Use pnpm'],
    ['store in memory - Keep line one\nand line two.', 'Keep line one\nand line two'],
    ['记住了吗？', ''],
    ['please remember that', ''],
    ['普通对话内容', ''],
  ])('extracts only the requested memory from %j', (input, expected) => {
    expect(explicitMemoryContentFromUserText(input)).toBe(expected);
  });

  it('handles long separator and punctuation runs without losing memory content', () => {
    const whitespace = '\t'.repeat(100_000);
    const punctuation = '!'.repeat(100_000);
    for (const prefix of ['记住', '保存记忆', 'remember', 'save memory']) {
      expect(explicitMemoryContentFromUserText(`${prefix}${whitespace}Use pnpm${punctuation}`))
        .toBe('Use pnpm');
      expect(explicitMemoryContentFromUserText(`${prefix}${whitespace}`)).toBe('');
    }
    expect(explicitMemoryContentFromUserText(`remember ${punctuation}keep this`))
      .toBe(`${punctuation}keep this`);
    expect(explicitMemoryContentFromUserText(`save${whitespace}not a memory request`)).toBe('');
  });
});
