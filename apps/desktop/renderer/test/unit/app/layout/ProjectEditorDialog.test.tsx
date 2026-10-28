// @vitest-environment happy-dom

import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectEditorDialog } from '../../../../src/app/layout/ProjectEditorDialog.js';
import { useConfiguredModelState } from '../../../../src/composition/ModelProviderFeatureBoundary.js';

vi.mock('../../../../src/composition/ModelProviderFeatureBoundary.js', () => ({ useConfiguredModelState: vi.fn(() => null) }));
vi.mock('../../../../src/composition/SkillsFeatureBoundary.js', () => ({ useSkillsFeatureSnapshot: () => ({ skills: [{ id: 'skill', name: 'Project skill', enabled: true }] }) }));
afterEach(() => { cleanup(); vi.mocked(useConfiguredModelState).mockReturnValue(null); });

const modelState = {
  activeProviderId: 'provider',
  providers: [{
    id: 'provider', name: 'Provider', provider: 'openai-responses' as const, enabled: true,
    baseUrl: 'https://example.test', apiKeySet: true, apiKeyPreview: '***',
    models: [
      { id: 'global', code: 'global', name: 'Global model', enabled: true, maxOutputTokens: 4096, thinkingEnabled: true, thinkingEfforts: ['low', 'high'] },
      { id: 'project', code: 'project', name: 'Project model', enabled: false, maxOutputTokens: 4096, thinkingEnabled: true, thinkingEfforts: ['low', 'high'] },
    ],
  }],
};

describe('ProjectEditorDialog', () => {
  it('saves an available non-global model with its thinking effort and default skills', async () => {
    vi.mocked(useConfiguredModelState).mockReturnValue(modelState);
    const onSave = vi.fn(async () => true);
    const user = userEvent.setup();
    render(<ProjectEditorDialog project={null} onSave={onSave} onClose={vi.fn()} onRemove={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'Configured');
    await user.click(screen.getByRole('button', { name: '新对话默认配置' }));
    // Global model inheritance must still allow an independent thinking preference.
    expect(screen.getByRole('combobox', { name: '思考强度' }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: '默认模型' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Project model' }));
    await user.click(screen.getByRole('combobox', { name: '思考强度' }));
    await user.click(await screen.findByRole('option', { name: 'high' }));
    await user.click(screen.getByRole('button', { name: '默认技能' }));
    await user.click(screen.getByRole('checkbox', { name: 'Project skill' }));
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ conversationDefaults: {
      model: { providerId: 'provider', modelId: 'project' }, thinking: { enabled: true, effort: 'high' }, skillIds: ['skill'],
    } })));
  });

  it('preserves custom edits across mode switches and saves only the following relationship', async () => {
    vi.mocked(useConfiguredModelState).mockReturnValue(modelState);
    const custom = { model: { providerId: 'provider', modelId: 'project' }, thinking: { enabled: true, effort: 'high' } };
    const project = { id: 'target', name: 'Target', createdAt: '', updatedAt: '', conversationDefaults: custom };
    const source = { id: 'source', name: 'Source', createdAt: '', updatedAt: '' };
    // Keep the dialog open so both submissions exercise the same mode drafts.
    const onSave = vi.fn(async () => false);
    const user = userEvent.setup();
    render(<ProjectEditorDialog project={project} projects={[project, source]} onSave={onSave} onClose={vi.fn()} onRemove={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '新对话默认配置' }));
    await user.click(screen.getByRole('button', { name: '跟随其他项目' }));
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('combobox', { name: '来源项目' }));
    await user.click(await screen.findByRole('option', { name: 'Source' }));
    await user.click(screen.getByRole('button', { name: '自行配置' }));
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ conversationDefaults: custom })));
    await user.click(screen.getByRole('button', { name: '跟随其他项目' }));
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ conversationDefaults: { sourceProjectId: source.id } })));
  });

  it('saves an unbound project and requires confirmation before removing an existing project', async () => {
    const actions = { onClose: vi.fn(), onRemove: vi.fn(async () => true), onSave: vi.fn(async () => true) };
    const view = render(<ProjectEditorDialog {...actions} project={null} />);
    expect(screen.queryByRole('button', { name: '移除项目' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New project' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(actions.onSave).toHaveBeenCalledWith({ name: 'New project', conversationDefaults: {}, roots: [], icon: null }));
    view.unmount();

    const project: WorkspaceProject = {
      id: 'project_demo', name: 'demo', path: '/workspace/demo',
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    };
    render(<ProjectEditorDialog {...actions} project={project} />);
    fireEvent.click(screen.getByRole('button', { name: '移除项目' }));
    expect(actions.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: '移除项目' }).at(-1)!);
    await waitFor(() => expect(actions.onRemove).toHaveBeenCalledExactlyOnceWith(project));
  });

  it('saves a chosen icon when creating a project', async () => {
    const onSave = vi.fn(async () => true);
    render(<ProjectEditorDialog project={null} onSave={onSave} onClose={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: 'Travel' } });
    await userEvent.click(screen.getByRole('button', { name: '更换项目图标' }));
    await userEvent.click(await screen.findByRole('button', { name: '帆船' }));
    await userEvent.click(screen.getByRole('button', { name: '正文颜色' }));
    await userEvent.click(screen.getByRole('button', { name: '更换项目图标' }));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      name: 'Travel', conversationDefaults: {}, roots: [], icon: { key: 'sailboat', color: 'text' },
    }));
  });

  it('cancels icon drafts and can explicitly restore the default icon', async () => {
    const project: WorkspaceProject = {
      id: 'project_demo', name: 'demo', icon: { key: 'terminal', color: '#6f80d6' },
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    };
    const actions = { onClose: vi.fn(), onRemove: vi.fn(), onSave: vi.fn(async () => true) };
    const view = render(<ProjectEditorDialog {...actions} project={project} />);
    await userEvent.click(screen.getByRole('button', { name: '更换项目图标' }));
    await userEvent.click(await screen.findByRole('button', { name: '山峰' }));
    await userEvent.click(screen.getByRole('button', { name: '更换项目图标' }));
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(actions.onSave).not.toHaveBeenCalled();
    expect(actions.onClose).toHaveBeenCalledOnce();
    view.unmount();

    render(<ProjectEditorDialog {...actions} project={project} />);
    await userEvent.click(screen.getByRole('button', { name: '更换项目图标' }));
    await userEvent.click(await screen.findByRole('button', { name: '恢复默认图标' }));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(actions.onSave).toHaveBeenCalledWith({ name: 'demo', conversationDefaults: {}, roots: [], icon: null }));
  });
});
