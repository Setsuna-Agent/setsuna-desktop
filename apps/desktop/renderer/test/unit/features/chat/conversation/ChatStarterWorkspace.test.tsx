// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatStarterWorkspace } from '../../../../../src/features/chat/conversation/ChatStarterWorkspace.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';

afterEach(cleanup);

it('finds a project by folder, selects it, and provides global-chat and project-creation actions', async () => {
  const projects = [
    { id: 'one', name: 'First', path: '/work/frontend', createdAt: '', updatedAt: '' },
    { id: 'two', name: 'Second', path: '/work/backend', createdAt: '', updatedAt: '' },
  ];
  const select = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn();
  render(<I18nProvider initialLocale="zh-CN">
    <ChatStarterWorkspace activeProject={projects[0]} projects={projects} onSelectProject={select} onCreateProject={create} />
  </I18nProvider>);

  fireEvent.click(screen.getByRole('button', { name: '切换项目' }));
  fireEvent.change(await screen.findByRole('textbox', { name: '搜索项目' }), { target: { value: 'BACKEND' } });
  expect(screen.queryByRole('button', { name: 'First' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Second' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '搜索项目' })).toBeNull());
  expect(select).toHaveBeenCalledExactlyOnceWith('two');

  fireEvent.click(screen.getByRole('button', { name: '切换项目' }));
  fireEvent.click(await screen.findByRole('button', { name: '不在项目中工作' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '搜索项目' })).toBeNull());
  expect(select).toHaveBeenLastCalledWith(null);

  fireEvent.click(screen.getByRole('button', { name: '切换项目' }));
  fireEvent.click(await screen.findByRole('button', { name: '新建项目' }));
  expect(create).toHaveBeenCalledOnce();
});
