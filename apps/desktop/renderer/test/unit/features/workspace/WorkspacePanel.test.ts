import { temporaryWorkspaceProjectId, type WorkspaceFileRead, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkspaceFilePreviewContent,
  WorkspaceOverviewPanel,
} from '../../../../src/features/workspace/WorkspacePanel.js';
import { I18nProvider, type AppLocale } from '../../../../src/shared/i18n/I18nProvider.js';

describe('WorkspaceFilePreviewContent', () => {
  it('renders image previews from runtime-classified data', () => {
    const html = renderWorkspaceFilePreview({
      file: workspaceFile({ kind: 'image', mimeType: 'image/webp', base64: 'UklGRg==' }),
    });

    expect(html).toContain('desktop-file-preview--image');
    expect(html).toContain('src="data:image/webp;base64,UklGRg=="');
    expect(html).not.toContain('desktop-code-line');
  });

  it('shows a clear notice instead of decoding unsupported binary files as text', () => {
    const html = renderWorkspaceFilePreview({
      file: workspaceFile({ kind: 'unsupported', reason: 'binary' }),
    });

    expect(html).toContain('暂不支持预览二进制文件');
    expect(html).toContain('请使用其他应用打开此文件查看');
    expect(html).not.toContain('desktop-code-line');
  });

  it('renders code lines as context-menu targets instead of left-click open buttons', () => {
    const html = renderWorkspaceFilePreview({
      file: {
        ...workspaceFile({ kind: 'text' }),
        content: 'const first = true;\nconst second = false;',
        path: 'src/example.ts',
      },
    });

    expect(html).toContain('data-workspace-file-line="1"');
    expect(html).toContain('data-workspace-file-line="2"');
    expect(html).not.toContain('<button class="desktop-code-line');
  });

  it('renders file preview notices in English', () => {
    const html = renderWorkspaceFilePreview({
      file: workspaceFile({ kind: 'unsupported', reason: 'binary' }),
    }, 'en-US');

    expect(html).toContain('Binary file preview is not supported');
    expect(html).toContain('Open this file in another app to view it.');
    expect(html).not.toContain('暂不支持预览');
  });
});

describe('WorkspaceOverviewPanel', () => {
  it('does not forward the React click event to the review callback', () => {
    const onOpenReviewPanel = vi.fn();
    const panel = captureWorkspaceOverviewPanel({
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
    const panel = captureWorkspaceOverviewPanel({
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
    const panel = captureWorkspaceOverviewPanel({
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
    const panel = captureWorkspaceOverviewPanel({
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

  it('renders every workspace overview action in English', () => {
    const html = renderWorkspaceOverviewPanel({
      activeProject: project,
      latestReviewSummary: null,
      onOpenBrowser: () => undefined,
      onOpenFilesPanel: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat: () => undefined,
      onOpenTerminalPanel: () => undefined,
    }, 'en-US');

    expect(html).toContain('Review');
    expect(html).toContain('Review code changes');
    expect(html).toContain('File explorer');
    expect(html).toContain('Terminal');
    expect(html).toContain('Project shell');
    expect(html).toContain('Side chat');
    expect(html).toContain('Browser');
    expect(html).not.toContain('审查');
    expect(html).not.toContain('侧边对话');
  });
});

type WorkspaceOverviewProps = Parameters<typeof WorkspaceOverviewPanel>[0];
type WorkspaceFilePreviewProps = Parameters<typeof WorkspaceFilePreviewContent>[0];

function renderWorkspaceFilePreview(props: WorkspaceFilePreviewProps, initialLocale: AppLocale = 'zh-CN'): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale },
    createElement(WorkspaceFilePreviewContent, props),
  ));
}

function renderWorkspaceOverviewPanel(props: WorkspaceOverviewProps, initialLocale: AppLocale = 'zh-CN'): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale },
    createElement(WorkspaceOverviewPanel, props),
  ));
}

function captureWorkspaceOverviewPanel(props: WorkspaceOverviewProps) {
  const captured: { panel?: ReturnType<typeof WorkspaceOverviewPanel> } = {};
  function Capture() {
    captured.panel = WorkspaceOverviewPanel(props);
    return captured.panel;
  }
  renderToStaticMarkup(createElement(I18nProvider, { initialLocale: 'zh-CN' }, createElement(Capture)));
  if (!captured.panel) throw new Error('Workspace overview panel did not render.');
  return captured.panel;
}

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
