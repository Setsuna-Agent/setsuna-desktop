import { describe, expect, it } from 'vitest';
import { runtimeReviewRequestFromTarget } from '../../../src/runtime/use-cases/thread-operations.js';

describe('runtimeReviewRequestFromTarget', () => {
  it('localizes the visible text and model prompt from the interface language', () => {
    expect(runtimeReviewRequestFromTarget(
      { type: 'uncommittedChanges' },
      'zh-CN',
    )).toMatchObject({
      displayText: '请审查当前项目中尚未提交的代码更改',
      language: 'zh-CN',
      prompt: expect.stringContaining('所有面向用户的内容必须使用简体中文'),
    });

    expect(runtimeReviewRequestFromTarget(
      { type: 'baseBranch', branch: 'main' },
      'en-US',
    )).toMatchObject({
      displayText: "Please review the current branch's code changes against 'main'",
      language: 'en-US',
      prompt: expect.stringContaining('All user-facing content must be in English'),
    });
  });
});
