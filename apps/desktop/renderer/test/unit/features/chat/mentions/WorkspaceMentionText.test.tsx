// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';
import { WorkspaceMentionText } from '../../../../../src/features/chat/mentions/WorkspaceMentionText.js';

afterEach(cleanup);

describe('WorkspaceMentionText', () => {
  it('opens sent file and directory mentions with their serialized paths', async () => {
    const onOpenWorkspaceFile = vi.fn();
    const onOpenWorkspaceDirectory = vi.fn();
    render(
      <MarkdownNavigationProvider
        onOpenWorkspaceFile={onOpenWorkspaceFile}
        onOpenWorkspaceDirectory={onOpenWorkspaceDirectory}
      >
        <WorkspaceMentionText content="@src/App.tsx" />
        <WorkspaceMentionText content="@src/components/" />
      </MarkdownNavigationProvider>,
    );

    const mentions = screen.getAllByRole('button');
    expect(mentions).toHaveLength(2);
    await userEvent.click(mentions[0]!);
    await userEvent.click(mentions[1]!);

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith('src/App.tsx');
    expect(onOpenWorkspaceDirectory).toHaveBeenCalledWith('src/components/');
  });
});
