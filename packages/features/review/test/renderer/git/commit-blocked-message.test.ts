import { describe, expect, it } from 'vitest';
import { commitBlockedMessage, commitPrerequisiteMessage } from '../../../src/renderer/git/commitBlockedMessage.js';
import { translateReviewMessage, type ReviewTranslate } from '../../../src/renderer/messages.js';

const t: ReviewTranslate = (key, params) => (
  key === 'common.cancel' ? '取消' : translateReviewMessage('zh-CN', key, params)
);

const ready = {
  busy: false,
  committableFileCount: 1,
  gitRepository: true,
  message: 'feat: draft subject',
  projectSelected: true,
  reviewLoading: false,
};

describe('commit prerequisites', () => {
  it('reports the first missing prerequisite for every Git action', () => {
    expect(commitPrerequisiteMessage(ready, t)).toBeNull();
    expect(commitPrerequisiteMessage({ ...ready, projectSelected: false }, t)).toBe('先选择项目再提交');
    expect(commitPrerequisiteMessage({ ...ready, reviewLoading: true }, t)).toBe('正在读取 Git 状态，请稍候');
    expect(commitPrerequisiteMessage({ ...ready, gitRepository: false }, t)).toBe('当前目录不是 Git 仓库');
    expect(commitPrerequisiteMessage({ ...ready, busy: true }, t)).toBe('已有 Git 操作在进行，请稍候');
    expect(commitPrerequisiteMessage({ ...ready, committableFileCount: 0 }, t)).toBe('暂存区没有更改，先暂存要提交的文件');
  });

  it('keeps the empty draft a commit-only problem', () => {
    expect(commitBlockedMessage(ready, t)).toBeNull();
    expect(commitBlockedMessage({ ...ready, message: '   ' }, t)).toBe('先填写提交信息，或用 AI 生成');
    expect(commitBlockedMessage({ ...ready, committableFileCount: 0, message: '' }, t))
      .toBe('暂存区没有更改，先暂存要提交的文件');
    expect(commitPrerequisiteMessage({ ...ready, committableFileCount: 0 }, t)).not.toBeNull();
  });
});
