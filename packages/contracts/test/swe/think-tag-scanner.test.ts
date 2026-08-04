import { describe, expect, it } from 'vitest';
import { thinkTagMatches } from '../../src/swe/think-tag-scanner.js';

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
});
