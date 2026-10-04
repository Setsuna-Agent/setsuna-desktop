// @vitest-environment happy-dom

import type { RuntimePluginSummary, RuntimePluginUiContribution } from '@setsuna-desktop/contracts';
import type { PluginManagementRendererService } from '@setsuna-desktop/feature-plugin-management/contracts';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { DeclarativePluginSidebarEntry } from '../../../../../src/kernel/declarative-plugin-ui/DeclarativePluginSidebarEntry.js';
import { pluginAppAppearanceKey } from '../../../../../src/kernel/declarative-plugin-ui/app-appearance/preferences.js';
import { usePluginAppAppearance } from '../../../../../src/kernel/declarative-plugin-ui/app-appearance/usePluginAppAppearance.js';
import { isAppAvatarPresetKey } from '../../../../../src/kernel/declarative-plugin-ui/app-appearance/app-avatar-presets.js';

const plugin: RuntimePluginSummary = {
  id: 'notes', name: 'Notes', installedAt: '2026-10-05',
  skills: [], mcpServers: [], hooks: [], hookCount: 0, resources: [],
};
const contribution: RuntimePluginUiContribution = {
  id: 'app', slot: 'renderer.plugin.page', navigation: { label: '笔记' }, tree: { type: 'text', text: 'Notes' },
};
const service = {} as PluginManagementRendererService;
const key = pluginAppAppearanceKey(plugin.id, contribution.id);

function entry(onOpen = vi.fn(), onRemove: () => Promise<void> = vi.fn(async () => undefined), onViewPlugin = vi.fn()) {
  return <DeclarativePluginSidebarEntry active={false} contribution={contribution} entryId="third-party.notes.app.navigation" missingContext={null}
    plugin={plugin} service={service} onOpen={onOpen} onRemove={onRemove} onViewPlugin={onViewPlugin} onModifyApp={vi.fn()} />;
}

async function openEditor(name = '笔记') {
  fireEvent.contextMenu(screen.getByRole('button', { name }));
  await userEvent.click(await screen.findByRole('menuitem', { name: '编辑应用' }));
  await screen.findByRole('dialog', { name: '编辑应用' });
}

describe('edit sidebar app', () => {
  afterEach(async () => {
    await act(async () => cleanup());
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('opens plugin details from the menu and linked plugin text without saving the editing draft', async () => {
    const onViewPlugin = vi.fn();
    render(entry(vi.fn(), undefined, onViewPlugin));
    fireEvent.contextMenu(screen.getByRole('button', { name: '笔记' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '查看插件' }));
    expect(onViewPlugin).toHaveBeenCalledOnce();
    await openEditor();
    const saved = window.localStorage.getItem(key);
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '未保存名称' } });
    await userEvent.click(screen.getByRole('button', { name: '关联插件：Notes' }));
    expect(onViewPlugin).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(key)).toBe(saved);
  });

  it('persists one random preset across mounts and migrates agent presets while preserving names and uploads', () => {
    window.localStorage.setItem(key, JSON.stringify({ name: '工作笔记', avatar: { type: 'preset', key: 'sun' } }));
    const first = renderHook(() => usePluginAppAppearance(plugin.id, contribution.id));
    const migrated = first.result.current.appearance;
    expect(migrated.name).toBe('工作笔记');
    expect(migrated.avatar.type).toBe('preset');
    if (migrated.avatar.type === 'preset') expect(isAppAvatarPresetKey(migrated.avatar.key)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(migrated);
    const second = renderHook(() => usePluginAppAppearance(plugin.id, contribution.id));
    expect(second.result.current.appearance).toEqual(migrated);
    first.unmount();
    second.unmount();
    const reopened = renderHook(() => usePluginAppAppearance(plugin.id, contribution.id));
    expect(reopened.result.current.appearance).toEqual(migrated);
    reopened.unmount();

    const custom = { name: '我的图片', avatar: { type: 'custom', dataUrl: 'data:image/png;base64,AQID' } };
    window.localStorage.setItem(key, JSON.stringify(custom));
    const uploaded = renderHook(() => usePluginAppAppearance(plugin.id, contribution.id));
    expect(uploaded.result.current.appearance).toEqual(custom);
  });

  it('cancels drafts, persists saved name/avatar, and synchronizes only the matching app', async () => {
    const onOpen = vi.fn();
    const observer = renderHook(() => usePluginAppAppearance(plugin.id, contribution.id));
    const other = renderHook(() => usePluginAppAppearance(plugin.id, 'other-page'));
    const initialAppearance = window.localStorage.getItem(key);
    const otherAppearance = other.result.current.appearance;
    const sidebar = render(entry(onOpen));
    await openEditor();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '未保存' } });
    fireEvent.click(screen.getByRole('button', { name: '内置头像 3' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(window.localStorage.getItem(key)).toBe(initialAppearance);

    await openEditor();
    expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('笔记');
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '  工作笔记  ' } });
    fireEvent.click(screen.getByRole('button', { name: '内置头像 3' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(observer.result.current.appearance).toEqual({ name: '工作笔记', avatar: { type: 'preset', key: 'chart-column' } });
    expect(other.result.current.appearance).toEqual(otherAppearance);
    sidebar.unmount();
    render(entry(onOpen));
    fireEvent.click(screen.getByRole('button', { name: '工作笔记' }));
    expect(onOpen).toHaveBeenCalledOnce();

    // Another desktop window can update or clear this app's preferences.
    act(() => {
      window.localStorage.setItem(key, JSON.stringify({ name: '跨窗口修改', avatar: { type: 'preset', key: 'table' } }));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
    expect(observer.result.current.appearance).toEqual({ name: '跨窗口修改', avatar: { type: 'preset', key: 'table' } });
    expect(screen.getByRole('button', { name: '跨窗口修改' })).toBeTruthy();
  });

  it('reads an uploaded image into the saved avatar and can switch back to a preset', async () => {
    render(entry());
    await openEditor();
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
    const file = new File([Uint8Array.from(atob(data), (character) => character.charCodeAt(0))], 'avatar.png', { type: 'image/png' });
    const input = screen.getByRole('dialog').querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ avatar: { type: 'custom', dataUrl: `data:image/png;base64,${data}` } });
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: '内置头像 2' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ avatar: { type: 'preset', key: 'table' } });
  });

  it('keeps the saved app and editable draft intact when upload validation or storage fails', async () => {
    window.localStorage.setItem(key, JSON.stringify({ avatar: { type: 'preset', key: 'notebook' } }));
    render(entry());
    await openEditor();
    const input = screen.getByRole('dialog').querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'avatar.svg', { type: 'image/svg+xml' })] } });
    expect((await screen.findByRole('alert')).textContent).toContain('PNG');
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ avatar: { type: 'preset', key: 'notebook' } });
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '工作笔记' } });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert').textContent).toBe('保存失败，请重试。');
    expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('工作笔记');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ avatar: { type: 'preset', key: 'notebook' } });
  });

  it('cancels deletion, prevents duplicate removal and allows retry after failure', async () => {
    let failRemoval!: (reason: Error) => void;
    const onRemove = vi.fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise((_, reject) => { failRemoval = reject; }))
      .mockResolvedValueOnce(undefined);
    render(entry(vi.fn(), onRemove));
    const openDelete = async () => {
      fireEvent.contextMenu(screen.getByRole('button', { name: '笔记' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
      await screen.findByRole('dialog', { name: '删除应用「笔记」？' });
    };
    await openDelete();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onRemove).not.toHaveBeenCalled();
    await openDelete();
    const remove = screen.getByRole('button', { name: '删除' });
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledOnce();
    await act(async () => failRemoval(new Error('Removal failed')));
    expect(screen.getByRole('alert').textContent).toBe('删除失败，请重试。');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRemove).toHaveBeenCalledTimes(2);
  });
});
