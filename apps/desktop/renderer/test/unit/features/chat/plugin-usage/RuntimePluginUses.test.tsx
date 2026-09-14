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
    const iconImage = { light: 'data:image/svg+xml;base64,PHN2Zy8+' };
    render(
      <RuntimePluginNavigationProvider onOpenPlugin={onOpenPlugin}>
        <RuntimePluginUses
          plugins={[{
            id: 'web-search',
            icon: 'web-search',
            installed: true,
            name: '网络搜索',
          }, {
            id: 'github',
            iconImage,
            installed: true,
            name: 'GitHub',
          }]}
        />
      </RuntimePluginNavigationProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: '网络搜索' }));
    render(
      <RuntimePluginUses
        plugins={[{ id: 'documents', installed: false, name: 'Word 文档处理' }]}
      />,
    );

    expect(onOpenPlugin).toHaveBeenCalledWith('web-search');
    expect(screen.getAllByText('已使用插件')).toHaveLength(3);
    expect(screen.getByText('Word 文档处理')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Word 文档处理' })).toBeNull();
  });
});
