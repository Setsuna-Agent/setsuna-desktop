import { temporaryWorkspaceProjectId, type WorkspaceFileRead, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkspaceFilePreviewContent,
  WorkspaceOverviewPanel,
} from '../../../../src/features/workspace/WorkspacePanel.js';

describe('WorkspaceFilePreviewContent', () => {
  it('renders image previews from runtime-classified data', () => {
    const html = renderToStaticMarkup(WorkspaceFilePreviewContent({
      file: workspaceFile({ kind: 'image', mimeType: 'image/webp', base64: 'UklGRg==' }),
    }));

    expect(html).toContain('desktop-file-preview--image');
    expect(html).toContain('src="data:image/webp;base64,UklGRg=="');
    expect(html).not.toContain('desktop-code-line');
  });

  it('shows a clear notice instead of decoding unsupported binary files as text', () => {
    const html = renderToStaticMarkup(WorkspaceFilePreviewContent({
      file: workspaceFile({ kind: 'unsupported', reason: 'binary' }),
    }));

    expect(html).toContain('暂不支持预览二进制文件');
    expect(html).toContain('请使用其他应用打开此文件查看');
    expect(html).not.toContain('desktop-code-line');
  });

  it('renders code lines as context-menu targets instead of left-click open buttons', () => {
    const html = renderToStaticMarkup(WorkspaceFilePreviewContent({
      file: {
        ...workspaceFile({ kind: 'text' }),
        content: 'const first = true;\nconst second = false;',
        path: 'src/example.ts',
      },
    }));

    expect(html).toContain('data-workspace-file-line="1"');
    expect(html).toContain('data-workspace-file-line="2"');
    expect(html).not.toContain('<button class="desktop-code-line');
  });
});

describe('WorkspaceOverviewPanel', () => {
  it('does not forward the React click event to the review callback', () => {
    const onOpenReviewPanel = vi.fn();
    const panel = WorkspaceOverviewPanel({
      activeProject: project,
      latestReviewSummary: null,
      onOpenFilesPanel: () => undefined,
      onOpenBrowser: () => undefined,
      onOpenReviewPanel,
      onOpenSideChat: () => undefined,
      onOpenTerminalPanel: () => undefined,
    });
    const reviewButton = panel.props.children.props.children[0];

    reviewButton.props.onClick({ type: 'click' });

    expect(onOpenReviewPanel).toHaveBeenCalledWith();
  });

  it('opens side chat from the workspace overview menu', () => {
    const onOpenSideChat = vi.fn();
    const panel = WorkspaceOverviewPanel({
      activeProject: project,
      latestReviewSummary: null,
      onOpenFilesPanel: () => undefined,
      onOpenBrowser: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat,
      onOpenTerminalPanel: () => undefined,
    });
    const sideChatButton = panel.props.children.props.children[3];

    sideChatButton.props.onClick();

    expect(onOpenSideChat).toHaveBeenCalledOnce();
  });

  it('opens the browser from the workspace overview menu', () => {
    const onOpenBrowser = vi.fn();
    const panel = WorkspaceOverviewPanel({
      activeProject: project,
      latestReviewSummary: null,
      onOpenBrowser,
      onOpenFilesPanel: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat: () => undefined,
      onOpenTerminalPanel: () => undefined,
    });
    const browserButton = panel.props.children.props.children[4];

    browserButton.props.onClick({ type: 'click' });

    expect(onOpenBrowser.mock.calls).toEqual([[]]);
  });

  it('在普通对话的临时目录中开放工作区操作', () => {
    const panel = WorkspaceOverviewPanel({
      activeProject: {
        ...project,
        id: temporaryWorkspaceProjectId({ date: '2026-07-18', threadId: 'thread_1' }),
        name: '临时目录',
      },
      latestReviewSummary: null,
      onOpenBrowser: () => undefined,
      onOpenFilesPanel: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat: () => undefined,
      onOpenTerminalPanel: () => undefined,
    });
    const actions = panel.props.children.props.children;

    expect(actions.slice(0, 3).every((action: { props: { disabled: boolean } }) => !action.props.disabled)).toBe(true);
    expect(actions[2].props.children[1].props.children[1].props.children).toBe('临时目录 Shell');
  });
});

const project: WorkspaceProject = {
  id: 'project_1',
  name: 'Fixture',
  path: '/tmp/fixture',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

function workspaceFile(preview: NonNullable<WorkspaceFileRead['preview']>): WorkspaceFileRead {
  return {
    projectId: project.id,
    path: 'fixture.bin',
    content: '',
    size: 8,
    preview,
    truncated: false,
  };
}
