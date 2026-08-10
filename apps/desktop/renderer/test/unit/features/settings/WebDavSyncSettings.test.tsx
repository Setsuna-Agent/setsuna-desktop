// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebDavSyncSettings } from '../../../../src/features/settings/webdav-sync/WebDavSyncSettings.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

const mocks = vi.hoisted(() => ({
  useDesktopWebDavSync: vi.fn(),
}));

vi.mock('../../../../src/app/controller/useDesktopWebDavSync.js', () => ({
  useDesktopWebDavSync: mocks.useDesktopWebDavSync,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WebDavSyncSettings', () => {
  it('shows the current local size beside every sync category', async () => {
    mocks.useDesktopWebDavSync.mockReturnValue(webDavSyncView());
    render(
      <I18nProvider initialLocale="zh-CN">
        <WebDavSyncSettings />
      </I18nProvider>,
    );

    const conversations = screen.getByText('对话与附件').closest('label');
    const credentials = screen.getByText('模型 API Key').closest('label');
    const usage = screen.getByText('用量记录').closest('label');
    expect(conversations).not.toBeNull();
    expect(credentials).not.toBeNull();
    expect(usage).not.toBeNull();
    expect(await within(conversations!).findByText('1.5 KB')).toBeTruthy();
    expect(within(credentials!).getByText('64 B')).toBeTruthy();
    expect(within(usage!).getByText('0 B')).toBeTruthy();
  });

  it('requires confirmation before enabling automatic backup', async () => {
    const user = userEvent.setup();
    const view = webDavSyncView();
    const updatePreferences = vi.fn(async () => undefined);
    view.state.automaticBackup = false;
    view.updatePreferences = updatePreferences;
    mocks.useDesktopWebDavSync.mockReturnValue(view);
    render(
      <I18nProvider initialLocale="zh-CN">
        <WebDavSyncSettings />
      </I18nProvider>,
    );

    const toggle = screen.getByRole('checkbox', { name: '启用自动备份' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await user.click(toggle);

    let dialog = await screen.findByRole('dialog', { name: '开启自动备份？' });
    expect(within(dialog).getByText(/后完成的备份会成为唯一保留副本/u)).toBeTruthy();
    expect(updatePreferences).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '开启自动备份？' })).toBeNull();
    expect(updatePreferences).not.toHaveBeenCalled();

    await user.click(toggle);
    dialog = await screen.findByRole('dialog', { name: '开启自动备份？' });
    await user.click(within(dialog).getByRole('button', { name: '确认开启' }));
    expect(updatePreferences).toHaveBeenCalledWith({ automaticBackup: true });
  });

  it('lets a connected device reveal its stored recovery key again', async () => {
    const user = userEvent.setup();
    const view = webDavSyncView();
    view.revealRecoveryKey = vi.fn(async () => 'setsuna-v1-recovery-key');
    mocks.useDesktopWebDavSync.mockReturnValue(view);
    render(
      <I18nProvider initialLocale="zh-CN">
        <WebDavSyncSettings />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: '查看恢复密钥' }));

    expect(view.revealRecoveryKey).toHaveBeenCalledOnce();
    expect(await screen.findByDisplayValue('setsuna-v1-recovery-key')).toBeTruthy();
  });

  it('offers a local reset when damaged sync metadata prevents loading', async () => {
    const user = userEvent.setup();
    const resetLocalConfiguration = vi.fn(async () => undefined);
    mocks.useDesktopWebDavSync.mockReturnValue({
      ...webDavSyncView(),
      error: '无法读取 WebDAV 同步配置。',
      resetLocalConfiguration,
      state: null,
    });
    render(
      <I18nProvider initialLocale="zh-CN">
        <WebDavSyncSettings />
      </I18nProvider>,
    );

    expect(screen.getByText('无法读取 WebDAV 同步配置。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重置本机同步配置' }));
    expect(resetLocalConfiguration).toHaveBeenCalledOnce();
  });
});

function webDavSyncView() {
  return {
    backupNow: vi.fn(async () => undefined),
    cancelCurrentOperation: vi.fn(async () => undefined),
    configure: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    error: null,
    getLocalCategorySummaries: vi.fn(async () => [
      { id: 'conversations', itemCount: 2, totalBytes: 1_536 },
      { id: 'memories', itemCount: 0, totalBytes: 0 },
      { id: 'preferences', itemCount: 1, totalBytes: 384 },
      { id: 'model_credentials', itemCount: 2, totalBytes: 64 },
      { id: 'user_skills', itemCount: 2, totalBytes: 768 },
      { id: 'usage', itemCount: 0, totalBytes: 0 },
    ]),
    inspectRestore: vi.fn(async () => undefined),
    listSnapshots: vi.fn(async () => ({ snapshots: [] })),
    loading: false,
    revealRecoveryKey: vi.fn(async () => ''),
    resetLocalConfiguration: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    state: {
      configPath: '/tmp/webdav-sync.json',
      configured: true,
      connection: {
        endpoint: 'https://dav.test',
        remoteRoot: '/setsuna',
        username: 'alice',
        passwordSet: true,
        allowInsecureHttp: false,
        repositoryId: '454b7f2f-1d85-4ed9-8539-a9ee4799cbd3',
        recoveryKeySet: true,
        deviceId: '55bc8840-ac7a-435a-b5a7-88c2e91e7d87',
        deviceName: '工作电脑',
      },
      automaticBackup: true,
      categories: [
        'conversations',
        'memories',
        'preferences',
        'model_credentials',
        'user_skills',
      ],
    },
    testConnection: vi.fn(async () => undefined),
    updatePreferences: vi.fn(async () => undefined),
  };
}
