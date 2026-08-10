// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimePluginNavigationProvider } from '../../../../../src/features/chat/artifacts/RuntimePluginNavigation.js';
import { RuntimePluginUses } from '../../../../../src/features/chat/artifacts/RuntimePluginUses.js';

afterEach(cleanup);

describe('RuntimePluginUses', () => {
  it('keeps plugin history visible and opens installed plugins', async () => {
    const onOpenPlugin = vi.fn();
    const installed = render(
      <RuntimePluginNavigationProvider onOpenPlugin={onOpenPlugin}>
        <RuntimePluginUses
          plugins={[{
            id: 'context7-docs',
            icon: 'context7',
            installed: true,
            name: 'Context7 文档查询',
          }]}
        />
      </RuntimePluginNavigationProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Context7 文档查询' }));
    const uninstalled = render(
      <RuntimePluginUses
        plugins={[{ id: 'documents', installed: false, name: 'Word 文档处理' }]}
      />,
    );

    expect(onOpenPlugin).toHaveBeenCalledWith('context7-docs');
    expect(installed.container.querySelector('.chat-capability-reference-icon')).toBeTruthy();
    expect(installed.container.querySelector('.chat-capability-reference-icon svg')?.getAttribute('width')).toBe('14');
    expect(installed.container.querySelector('.chat-capability-reference-icon svg')?.getAttribute('height')).toBe('14');
    expect(installed.container.querySelector('.desktop-plugin-icon')).toBeNull();
    expect(uninstalled.container.querySelector('.chat-capability-reference-icon')).toBeTruthy();
    expect(screen.getAllByText('已使用插件')).toHaveLength(2);
    expect(screen.getByText('Word 文档处理')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Word 文档处理' })).toBeNull();
  });
});
