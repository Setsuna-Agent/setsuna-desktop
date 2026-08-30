// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { SettingsDirectoryList } from '../../../../src/shared/ui/SettingsListFields.js';

describe('SettingsDirectoryList', () => {
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
  });

  it('adds a native-selected directory and removes an existing directory', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('D:\\shared-skills');
    const onSave = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'setsunaDesktop', {
      configurable: true,
      value: { desktop: { selectDirectory } },
    });

    render(
      <I18nProvider initialLocale="zh-CN">
        <SettingsDirectoryList
          description="从默认位置之外加载 Skill"
          label="额外 Skill 目录"
          value={['C:\\existing-skills']}
          onSave={onSave}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加目录' }));
    await waitFor(() => {
      expect(selectDirectory).toHaveBeenCalledWith({ title: '选择额外 Skill 目录' });
      expect(onSave).toHaveBeenCalledWith(['C:\\existing-skills', 'D:\\shared-skills']);
    });

    fireEvent.click(screen.getByRole('button', { name: '移除 C:\\existing-skills' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith([]));
  });

  it('resolves home directory presets and toggles inheritance with one click', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const inspectDirectories = vi.fn(async (paths: readonly string[]) => paths.map((path) => ({
      count: path.includes('.agents') ? 2 : 0,
      path,
    })));
    Object.defineProperty(window, 'setsunaDesktop', {
      configurable: true,
      value: {
        desktop: {
          getUserProfile: vi.fn().mockResolvedValue({ homeDir: 'C:\\Users\\setsuna' }),
          platform: 'win32',
        },
      },
    });

    render(
      <I18nProvider initialLocale="zh-CN">
        <SettingsDirectoryList
          description="继承其他客户端的 Skill"
          formatPresetCount={(count) => `${count} 个`}
          inspectDirectories={inspectDirectories}
          label="额外 Skill 目录"
          presetAddLabel="继承"
          presetRemoveLabel="取消"
          presets={[
            { id: 'global', label: '全局共享 Skills', homeRelativePath: ['.agents', 'skills'] },
            { id: 'claude', label: 'Claude Skills', homeRelativePath: ['.claude', 'skills'] },
            { id: 'pi', label: 'Pi Skills', homeRelativePath: ['.pi', 'agent', 'skills'] },
          ]}
          value={['C:\\Users\\setsuna\\.pi\\agent\\skills']}
          onSave={onSave}
        />
      </I18nProvider>,
    );

    expect(await screen.findByText('C:\\Users\\setsuna\\.agents\\skills')).toBeTruthy();
    expect(screen.getByText('2 个')).toBeTruthy();
    expect(screen.queryByText('Claude Skills')).toBeNull();
    expect(screen.getByText('C:\\Users\\setsuna\\.pi\\agent\\skills')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '继承 全局共享 Skills' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      'C:\\Users\\setsuna\\.pi\\agent\\skills',
      'C:\\Users\\setsuna\\.agents\\skills',
    ]));

    fireEvent.click(screen.getByRole('button', { name: '取消 Pi Skills' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith([]));
  });
});
