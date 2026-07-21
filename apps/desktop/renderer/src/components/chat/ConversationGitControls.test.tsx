import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GitActionButton, commitSuccessMessage } from './ConversationGitControls.js';

describe('ConversationGitControls', () => {
  it('renders a stable animated class and accessible busy state while a Git action is running', () => {
    const html = renderToStaticMarkup(createElement(GitActionButton, {
      disabled: true,
      icon: createElement('span'),
      loading: true,
      title: '提交中...',
      onClick: () => undefined,
    }));

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('chat-git-loading-icon');
    expect(html).toContain('提交中...');
  });

  it('includes the commit hash in success feedback when available', () => {
    expect(commitSuccessMessage({ commitHash: 'abc1234' }, false)).toBe('提交成功 · abc1234');
    expect(commitSuccessMessage({ commitHash: 'abc1234' }, true)).toBe('提交并推送成功 · abc1234');
    expect(commitSuccessMessage({ commitHash: '' }, false)).toBe('提交成功');
  });
});
