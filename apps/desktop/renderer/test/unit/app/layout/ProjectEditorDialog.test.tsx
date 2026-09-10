// @vitest-environment happy-dom

import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectEditorDialog } from '../../../../src/app/layout/ProjectEditorDialog.js';

afterEach(cleanup);

describe('ProjectEditorDialog', () => {
  it('saves an unbound project and requires confirmation before removing an existing project', async () => {
    const actions = { onClose: vi.fn(), onRemove: vi.fn(async () => true), onSave: vi.fn(async () => true) };
    const view = render(<ProjectEditorDialog {...actions} project={null} />);
    expect(screen.getByRole('dialog', { name: '新建项目' })).toBeTruthy();
    expect(screen.getByText('尚未关联本机目录')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '移除项目' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New project' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(actions.onSave).toHaveBeenCalledWith({ name: 'New project', path: null }));
    view.unmount();

    const project: WorkspaceProject = {
      id: 'project_demo', name: 'demo', path: '/workspace/demo',
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    };
    render(<ProjectEditorDialog {...actions} project={project} />);
    expect(screen.getByRole('dialog', { name: '编辑项目' })).toBeTruthy();
    expect(screen.getByText('/workspace/demo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '移除项目' }));
    expect(actions.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: '移除项目' }).at(-1)!);
    await waitFor(() => expect(actions.onRemove).toHaveBeenCalledExactlyOnceWith(project));
  });
});
