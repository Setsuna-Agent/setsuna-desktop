import { describe, expect, it } from 'vitest';
import { classifyCodexReviewFindings } from '../codex-review-findings.mjs';

function comment(priority: number, title = 'Review finding') {
  return {
    body: `**<sub><sub>![P${priority} Badge](https://img.shields.io/badge/P${priority}-yellow?style=flat)</sub></sub> ${title}`,
    url: `https://github.com/Setsuna-Agent/setsuna-desktop/pull/1#P${priority}`,
  };
}

describe('classifyCodexReviewFindings', () => {
  it('blocks P0 and P1 findings while keeping P2 and later advisory', () => {
    expect(classifyCodexReviewFindings([
      comment(0),
      comment(1),
      comment(2),
      comment(3),
    ])).toEqual({
      blocking: [
        { priority: 'P0', url: expect.stringContaining('#P0') },
        { priority: 'P1', url: expect.stringContaining('#P1') },
      ],
      advisory: [
        { priority: 'P2', url: expect.stringContaining('#P2') },
        { priority: 'P3', url: expect.stringContaining('#P3') },
      ],
    });
  });

  it('uses the Codex priority badge instead of priority text in the explanation', () => {
    const result = classifyCodexReviewFindings([
      comment(2, 'Do not regress the older P1 behavior'),
    ]);

    expect(result.blocking).toEqual([]);
    expect(result.advisory).toEqual([
      { priority: 'P2', url: expect.stringContaining('#P2') },
    ]);
  });

  it('fails closed when a finding has no recognized priority badge', () => {
    expect(classifyCodexReviewFindings([{
      body: 'Review finding without a standard Codex badge',
      url: 'https://github.com/Setsuna-Agent/setsuna-desktop/pull/1#unknown',
    }])).toEqual({
      blocking: [{
        priority: 'unknown',
        url: 'https://github.com/Setsuna-Agent/setsuna-desktop/pull/1#unknown',
      }],
      advisory: [],
    });
  });

  it('rejects malformed input instead of silently passing the gate', () => {
    // @ts-expect-error Exercise the CLI boundary with a non-array JSON value.
    expect(() => classifyCodexReviewFindings({})).toThrow('Expected an array');
    // @ts-expect-error Exercise the CLI boundary with a malformed comment.
    expect(() => classifyCodexReviewFindings([{}])).toThrow('have a URL');
  });
});
