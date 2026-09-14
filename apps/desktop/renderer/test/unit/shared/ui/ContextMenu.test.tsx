// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextMenu } from '../../../../src/shared/ui/ContextMenu.js';

afterEach(cleanup);

it('supports nested keyboard selection without activating disabled items', async () => {
  const choose = vi.fn();
  render(<ContextMenu trigger={['click']} menu={{ selectedKeys: ['origin/main'], items: [{
    key: 'branches', label: 'Branches', children: [{
      key: 'remotes', label: 'Remotes', children: [
        { key: 'origin/main', label: 'origin/main', onClick: choose },
        { key: 'archived', label: 'Archived', disabled: true, onClick: choose },
      ],
    }],
  }] }}><button type="button">Git menu</button></ContextMenu>);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Git menu' }), { key: 'ArrowDown' });
  const branches = await screen.findByRole('menuitem', { name: /^Branches/ });
  fireEvent.keyDown(branches, { key: 'ArrowRight' });
  const remotes = await screen.findByRole('menuitem', { name: /^Remotes/ });
  fireEvent.keyDown(remotes, { key: 'ArrowRight' });
  const branch = await screen.findByRole('menuitem', { name: 'origin/main' });
  const archived = screen.getByRole('menuitem', { name: 'Archived' });
  const menus = [branches, remotes, branch].map((item) => item.closest<HTMLElement>('[role="menu"]')!);
  expect(new Set(menus).size).toBe(3);
  expect(archived.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(archived);
  expect(choose).not.toHaveBeenCalled();
  fireEvent.keyDown(branch, { key: 'Enter' });
  expect(choose).toHaveBeenCalledOnce();
});
