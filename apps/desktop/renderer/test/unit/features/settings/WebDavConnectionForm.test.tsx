// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopWebDavSyncErrorMessage } from '../../../../src/app/controller/useDesktopWebDavSync.js';
import { WebDavConnectionForm } from '../../../../src/features/settings/webdav-sync/WebDavConnectionForm.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

describe('WebDavConnectionForm', () => {
  it('removes Electron IPC wrapping from connection errors', () => {
    expect(desktopWebDavSyncErrorMessage(new Error(
      "Error invoking remote method 'webdav-sync:configure': Error: 无法访问 WebDAV 服务器。",
    ))).toBe('无法访问 WebDAV 服务器。');
  });

  it('reveals the password and tests a complete draft without submitting it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const onTest = vi.fn(async () => undefined);
    renderForm({ onSubmit, onTest });

    const password = screen.getByLabelText('密码或应用专用密码') as HTMLInputElement;
    expect(password.type).toBe('password');
    await user.click(screen.getByRole('button', { name: '显示密码' }));
    expect(password.type).toBe('text');
    expect(screen.getByRole('button', { name: '隐藏密码' })).toBeTruthy();

    await fillRequiredDraft(user, password);
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() => expect(onTest).toHaveBeenCalledOnce());
    expect(onTest).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://dav.example.com',
      remoteRoot: '/setsuna',
      username: 'alice',
      password: 'secret',
      repositoryMode: 'create',
    }));
    expect(await screen.findByText(/连接、认证和远端读写测试均已通过/u)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders a failed draft test only once', async () => {
    const user = userEvent.setup();
    const onTest = vi.fn(async () => {
      throw new Error('TLS 证书校验失败，请检查证书有效期、域名和信任链。');
    });
    renderForm({ onSubmit: async () => undefined, onTest });

    const password = screen.getByLabelText('密码或应用专用密码') as HTMLInputElement;
    await fillRequiredDraft(user, password);
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(screen.getAllByText(/TLS 证书校验失败/u)).toHaveLength(1);
  });
});

function renderForm(input: {
  onSubmit: ComponentProps<typeof WebDavConnectionForm>['onSubmit'];
  onTest: ComponentProps<typeof WebDavConnectionForm>['onTest'];
}) {
  return render(
    <I18nProvider initialLocale="zh-CN">
      <WebDavConnectionForm disabled={false} {...input} />
    </I18nProvider>,
  );
}

async function fillRequiredDraft(
  user: ReturnType<typeof userEvent.setup>,
  password: HTMLInputElement,
) {
  await user.type(screen.getByLabelText('服务器地址'), 'https://dav.example.com');
  await user.type(screen.getByLabelText('用户名'), 'alice');
  await user.type(password, 'secret');
}
