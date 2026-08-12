import { describe, expect, it } from 'vitest';
import { runtimeReviewPolicyMessage } from '../../../src/loop/context/runtime-review-profile.js';

describe('runtimeReviewPolicyMessage', () => {
  it.each([
    ['zh-CN', 'Simplified Chinese', '“审查开始”'],
    ['en-US', 'in English', '“Review started”'],
  ] as const)('localizes review output guidance for %s', (language, localeRule, forbiddenHeading) => {
    const message = runtimeReviewPolicyMessage(
      'turn_review',
      '2026-08-12T00:00:00.000Z',
      language,
    );

    expect(message.content).toContain(localeRule);
    expect(message.content).toContain(forbiddenHeading);
    expect(message.content).toContain('[P0-P3] Short title — path:line');
  });
});
