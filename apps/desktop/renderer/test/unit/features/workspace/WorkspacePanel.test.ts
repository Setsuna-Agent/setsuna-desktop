import { temporaryWorkspaceProjectId, type WorkspaceFileRead, type WorkspaceProject } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkspaceFilePreviewContent,
  WorkspaceOverviewPanel,
} from '../../../../src/features/workspace/WorkspacePanel.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

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

  it('renders text files through the shared code-preview surface', () => {
    const html = renderWorkspaceFilePreview({
      file: {
        ...workspaceFile({ kind: 'text' }),
        content: 'const ready = true;',
        path: 'src/example.ts',
      },
    });

    expect(html).toContain('desktop-code-editor__pierre');
    expect(html).toContain('const ready = true;');
  });

  it('identifies text previews that are incomplete after the full-file budget', () => {
    const html = renderWorkspaceFilePreview({
      file: {
        ...workspaceFile({ kind: 'text' }),
        content: 'partial content',
        path: 'generated/large.txt',
        truncated: true,
      },
    });

    expect(html).toContain('role="status"');
    expect(html).toContain('文件超过可加载上限，仅显示前 8 MB。');
  });

});

describe('WorkspaceOverviewPanel', () => {
  it('routes the side-chat and browser actions to their handlers', () => {
    const onOpenSideChat = vi.fn();
    const onOpenBrowser = vi.fn();
    const panel = captureWorkspaceOverviewPanel({
      activeProject: project,
      latestReviewSummary: null,
      onOpenBrowser,
      onOpenFilesPanel: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat,
      onOpenTerminalPanel: () => undefined,
    });
    const actions = panel.props.children.props.children;

    actions[3].props.onClick();
    actions[4].props.onClick();

    expect(onOpenSideChat).toHaveBeenCalledOnce();
    expect(onOpenBrowser).toHaveBeenCalledOnce();
  });

  it('shows conversation debug only when the developer action is provided', () => {
    const baseProps: WorkspaceOverviewProps = {
      activeProject: project,
      latestReviewSummary: null,
      onOpenBrowser: () => undefined,
      onOpenFilesPanel: () => undefined,
      onOpenReviewPanel: () => undefined,
      onOpenSideChat: () => undefined,
      onOpenTerminalPanel: () => undefined,
    };

    expect(renderWorkspaceOverviewPanel(baseProps)).not.toContain('对话调试');
    expect(renderWorkspaceOverviewPanel({
      ...baseProps,
      onOpenConversationDebug: () => undefined,
    })).toContain('对话调试');
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

});

type WorkspaceOverviewProps = Parameters<typeof WorkspaceOverviewPanel>[0];
type WorkspaceFilePreviewProps = Parameters<typeof WorkspaceFilePreviewContent>[0];

function renderWorkspaceFilePreview(props: WorkspaceFilePreviewProps): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: 'zh-CN' },
    createElement(WorkspaceFilePreviewContent, props),
  ));
}

function renderWorkspaceOverviewPanel(props: WorkspaceOverviewProps): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: 'zh-CN' },
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
