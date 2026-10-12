import type { WorkspaceFileRead, WorkspaceProject } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceFilePreviewContent } from '../../../../src/features/workspace/WorkspacePanel.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

describe('WorkspaceFilePreviewContent', () => {
  it('renders image previews from runtime-classified data', () => {
    const html = renderWorkspaceFilePreview({
      file: workspaceFile({ kind: 'image', mimeType: 'image/webp', base64: 'UklGRg==' }),
    });
    expect(html).toContain('src="data:image/webp;base64,UklGRg=="');
  });

  it('shows a clear notice instead of decoding unsupported binary files as text', () => {
    const html = renderWorkspaceFilePreview({
      file: workspaceFile({ kind: 'unsupported', reason: 'binary' }),
    });

    expect(html).toContain('暂不支持预览二进制文件');
    expect(html).toContain('请使用其他应用打开此文件查看');
  });

  it('renders text files through the shared code-preview surface', () => {
    const html = renderWorkspaceFilePreview({
      file: {
        ...workspaceFile({ kind: 'text' }),
        content: 'const ready = true;',
        path: 'src/example.ts',
      },
    });
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

type WorkspaceFilePreviewProps = Parameters<typeof WorkspaceFilePreviewContent>[0];

function renderWorkspaceFilePreview(props: WorkspaceFilePreviewProps): string {
  return renderToStaticMarkup(createElement(
    I18nProvider,
    { initialLocale: 'zh-CN' },
    createElement(WorkspaceFilePreviewContent, props),
  ));
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
