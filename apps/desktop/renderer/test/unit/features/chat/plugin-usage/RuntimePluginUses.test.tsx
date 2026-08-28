// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimePluginNavigationProvider } from '../../../../../src/features/chat/plugin-usage/RuntimePluginNavigation.js';
import { RuntimePluginUses } from '../../../../../src/features/chat/plugin-usage/RuntimePluginUses.js';

afterEach(cleanup);

describe('RuntimePluginUses', () => {
  it('keeps plugin history visible and opens installed plugins', async () => {
    const onOpenPlugin = vi.fn();
    const installed = render(
      <RuntimePluginNavigationProvider onOpenPlugin={onOpenPlugin}>
        <RuntimePluginUses
          plugins={[{
            id: 'web-search',
            icon: 'web-search',
            installed: true,
            name: '网络搜索',
          }]}
        />
      </RuntimePluginNavigationProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: '网络搜索' }));
    const uninstalled = render(
      <RuntimePluginUses
        plugins={[{ id: 'documents', installed: false, name: 'Word 文档处理' }]}
      />,
    );

    expect(onOpenPlugin).toHaveBeenCalledWith('web-search');
    expect(installed.container.querySelector('.desktop-plugin-icon')?.getAttribute('data-plugin-icon')).toBe('web-search');
    expect(installed.container.querySelector('.desktop-plugin-icon--inline')).toBeTruthy();
    expect(uninstalled.container.querySelector('.desktop-plugin-icon')?.getAttribute('data-plugin-icon')).toBe('documents');
    expect(screen.getAllByText('已使用插件')).toHaveLength(2);
    expect(screen.getByText('Word 文档处理')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Word 文档处理' })).toBeNull();
  });
});
