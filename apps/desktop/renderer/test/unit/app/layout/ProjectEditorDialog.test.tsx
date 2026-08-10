import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectEditorDialog } from '../../../../src/app/layout/ProjectEditorDialog.js';

describe('ProjectEditorDialog', () => {
  it('uses the same editor for an empty project and an existing bound project', () => {
    const actions = {
      onClose: vi.fn(),
      onRemove: vi.fn(async () => true),
      onSave: vi.fn(async () => true),
    };
    const createHtml = renderToStaticMarkup(createElement(ProjectEditorDialog, {
      ...actions,
      project: null,
    }));
    const project: WorkspaceProject = {
      id: 'project_demo',
      name: 'demo',
      path: '/workspace/demo',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    };
    const editHtml = renderToStaticMarkup(createElement(ProjectEditorDialog, {
      ...actions,
      project,
    }));

    expect(createHtml).toContain('新建项目');
    expect(createHtml).toContain('尚未关联本机目录');
    expect(createHtml).not.toContain('移除项目');
    expect(editHtml).toContain('编辑项目');
    expect(editHtml).toContain('/workspace/demo');
    expect(editHtml).toContain('移除项目');
  });
});
