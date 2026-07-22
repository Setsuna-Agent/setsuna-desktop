import { describe, expect, it } from 'vitest';
import { DEFAULT_THREAD_TITLE, fallbackThreadTitle, THREAD_TITLE_MAX_LENGTH } from '../src/thread-title.js';

describe('thread title fallback', () => {
  it('keeps the previous first-message preview behavior as a bounded fallback', () => {
    const input = `  ${'标题内容'.repeat(30)}  `;
    expect(fallbackThreadTitle(input)).toHaveLength(THREAD_TITLE_MAX_LENGTH);
    expect(fallbackThreadTitle(input)).toBe(input.trim().slice(0, THREAD_TITLE_MAX_LENGTH));
  });

  it('describes attachment-only messages and otherwise preserves the placeholder', () => {
    expect(fallbackThreadTitle('', 1)).toBe('附件');
    expect(fallbackThreadTitle('', 3)).toBe('3 个附件');
    expect(fallbackThreadTitle('')).toBe(DEFAULT_THREAD_TITLE);
  });
});
