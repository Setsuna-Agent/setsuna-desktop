// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsPluginIcon } from '../../../../../src/kernel/declarative-plugin-ui/app-appearance/SettingsPluginIcon.js';
import { pluginAppAppearanceKey } from '../../../../../src/kernel/declarative-plugin-ui/app-appearance/preferences.js';
import { pluginIconAppearanceKey } from '../../../../../src/shared/preferences/pluginIconAppearance.js';
import { usePluginIconAppearance } from '../../../../../src/shared/preferences/usePluginIconAppearance.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: '修改插件图标' }));
  return screen.findByRole('dialog', { name: '修改插件图标' });
}

it('commits or discards icon drafts, isolates plugin and app identities, and synchronizes saved preferences', async () => {
  const key = pluginIconAppearanceKey('search');
  const appKey = pluginAppAppearanceKey('search', 'page');
  const appPreference = JSON.stringify({ name: 'My app', avatar: { type: 'preset', key: 'notebook' } });
  window.localStorage.setItem(appKey, appPreference);
  const observer = renderHook(() => usePluginIconAppearance('search'));
  const other = renderHook(() => usePluginIconAppearance('another-plugin'));
  const editor = render(<SettingsPluginIcon pluginId="search" appContributionId="page" editable variant="list" />);
  await openEditor();
  fireEvent.click(screen.getByRole('button', { name: '内置头像 2' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(window.localStorage.getItem(key)).toBeNull();
  expect(observer.result.current.appearance).toEqual({});

  await openEditor();
  fireEvent.click(screen.getByRole('button', { name: '内置头像 2' }));
  fireEvent.click(screen.getByRole('button', { name: '头像颜色 #12b84c' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  const saved = { avatar: { type: 'preset', key: 'table' }, avatarColor: '#12b84c' };
  expect(observer.result.current.appearance).toEqual(saved);
  expect(other.result.current.appearance).toEqual({});
  expect(window.localStorage.getItem(appKey)).toBe(appPreference);

  // Updated bundle metadata and remounting must not replace the user's icon.
  editor.unmount();
  render(<SettingsPluginIcon pluginId="search" name="web-search" editable variant="list" />);
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(saved);
  act(() => {
    window.localStorage.setItem(key, JSON.stringify({ avatar: { type: 'preset', key: 'camera' } }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
  expect(observer.result.current.appearance).toEqual({ avatar: { type: 'preset', key: 'camera' } });
  await openEditor();
  fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
  expect(observer.result.current.appearance).toEqual({ avatar: { type: 'preset', key: 'camera' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(observer.result.current.appearance).toEqual({});
  expect(window.localStorage.getItem(appKey)).toBe(appPreference);
});

it('keeps uploaded icon drafts after storage failure and publishes only a successful save', async () => {
  const observer = renderHook(() => usePluginIconAppearance('search'));
  render(<SettingsPluginIcon pluginId="search" editable variant="list" />);
  const dialog = await openEditor();
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
  const file = new File([Uint8Array.from(atob(data), (character) => character.charCodeAt(0))], 'icon.png', { type: 'image/png' });
  fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false));
  const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('保存失败，请重试。');
  expect(observer.result.current.appearance).toEqual({});
  expect(screen.getByRole('dialog')).toBeTruthy();
  write.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(observer.result.current.appearance).toEqual({ avatar: { type: 'custom', dataUrl: `data:image/png;base64,${data}` } });
  expect(screen.queryByRole('dialog')).toBeNull();
});
