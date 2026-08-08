// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimePluginNavigationProvider } from '../../../../../src/features/chat/artifacts/RuntimePluginNavigation.js';
import { RuntimePluginUses } from '../../../../../src/features/chat/artifacts/RuntimePluginUses.js';

afterEach(cleanup);

describe('RuntimePluginUses', () => {
  it('opens an installed plugin from conversation history', async () => {
    const onOpenPlugin = vi.fn();
    render(
      <RuntimePluginNavigationProvider onOpenPlugin={onOpenPlugin}>
        <RuntimePluginUses
          active={false}
          plugins={[{
            id: 'context7-docs',
            installed: true,
            name: 'Context7 文档查询',
          }]}
        />
      </RuntimePluginNavigationProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Context7 文档查询' }));

    expect(onOpenPlugin).toHaveBeenCalledWith('context7-docs');
  });
});
