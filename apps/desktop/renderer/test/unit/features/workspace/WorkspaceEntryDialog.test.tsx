// @vitest-environment happy-dom

import { WORKSPACE_ENTRY_EXISTS_ERROR_CODE } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceEntryDialog, type WorkspaceEntryDialogRequest } from '../../../../src/features/workspace/WorkspaceEntryDialog.js';
import { createDesktopRuntimeClient } from '../../../../src/services/runtime-client/client.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

const originalBridge = window.setsunaDesktop;
afterEach(() => { cleanup(); window.setsunaDesktop = originalBridge; });

it.each([
  { locale: 'zh-CN', mode: 'create', message: '已存在名为“test”的文件或文件夹，请更换名称。' },
  { locale: 'en-US', mode: 'rename', message: 'A file or folder named “test” already exists. Choose another name.' },
] as const)('localizes a $mode conflict in $locale and lets the user retry with another name', async ({ locale, mode, message }) => {
  const requestBridge = vi.fn().mockResolvedValueOnce({
    ok: false, status: 409,
    error: {
      code: WORKSPACE_ENTRY_EXISTS_ERROR_CODE, retryable: false,
      message: 'EEXIST: file already exists, mkdir C:/private/test (POST /v1/projects/project/entries)',
    },
  }).mockResolvedValue({ ok: true, value: { name: 'available', path: 'available', type: 'directory' } });
  window.setsunaDesktop = { runtime: { request: requestBridge } } as unknown as Window['setsunaDesktop'];
  const client = createDesktopRuntimeClient();
  const request: WorkspaceEntryDialogRequest = mode === 'create'
    ? { mode: 'create', type: 'directory', parentPath: '' }
    : { mode: 'rename', entry: { name: 'original.txt', path: 'original.txt', type: 'file' } };
  const onClose = vi.fn();
  render(<I18nProvider initialLocale={locale}><WorkspaceEntryDialog request={request} onClose={onClose}
    onSubmit={async (name) => {
      if (request.mode === 'create') await client.createProjectEntry('project', { parentPath: '', name, type: 'directory' });
      else await client.renameProjectEntry('project', request.entry.path, { name });
    }}
  /></I18nProvider>);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'test' } });
  fireEvent.submit(input.closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(onClose).not.toHaveBeenCalled();
  expect(input.value).toBe('test');
  fireEvent.change(input, { target: { value: 'available' } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(requestBridge).toHaveBeenCalledTimes(2);
  expect(requestBridge.mock.lastCall?.[0]).toMatchObject({ body: { name: 'available' } });
});
