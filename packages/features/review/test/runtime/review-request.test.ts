import { describe, expect, it } from 'vitest';
import { createReviewTurnRequest } from '../../src/runtime/review-request.js';

describe('createReviewTurnRequest', () => {
  it('localizes visible text, model prompt, and review policy in the Feature', () => {
    const zhRequest = createReviewTurnRequest(
      { type: 'uncommittedChanges' },
      'zh-CN',
    );
    expect(zhRequest).toMatchObject({
      displayText: '请审查当前项目中尚未提交的代码更改',
      language: 'zh-CN',
      prompt: expect.stringContaining('进度说明和最终结果均遵循用户请求的回复语言'),
      developerInstructions: expect.stringContaining('“审查开始”'),
    });

    const enRequest = createReviewTurnRequest(
      { type: 'baseBranch', branch: 'main' },
      'en-US',
    );
    expect(enRequest).toMatchObject({
      displayText: "Please review the current branch's code changes against 'main'",
      language: 'en-US',
      prompt: expect.stringContaining("Follow the user's requested response language"),
      developerInstructions: expect.stringContaining('[P0-P3] Short title — path:line'),
    });
    expect(enRequest.developerInstructions).toContain('“Review started”');
  });
});
