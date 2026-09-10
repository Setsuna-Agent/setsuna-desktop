// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextMenu } from '../../../../src/shared/ui/ContextMenu.js';

afterEach(() => {
  cleanup();
  document.querySelector('[data-context-menu-test]')?.remove();
  document.documentElement.removeAttribute('style');
});

it('shares live theme tokens across nested menus and supports keyboard selection without activating disabled items', async () => {
  const styles = document.createElement('style');
  styles.dataset.contextMenuTest = '';
  styles.textContent = readFileSync('packages/renderer-ui/src/styles/overlays.css', 'utf8');
  document.head.append(styles);
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
  for (const [surface, text] of [
    ['rgb(32, 32, 32)', 'rgb(220, 220, 220)'],
    ['rgb(255, 255, 255)', 'rgb(32, 32, 32)'],
  ]) {
    document.documentElement.style.setProperty('--app-surface', surface);
    document.documentElement.style.setProperty('--app-text', text);
    for (const menu of menus) expect(getComputedStyle(menu).backgroundColor).toBe(surface);
    for (const item of [branches, remotes, branch]) expect(getComputedStyle(item).color).toBe(text);
  }
  expect(archived.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(archived);
  expect(choose).not.toHaveBeenCalled();
  fireEvent.keyDown(branch, { key: 'Enter' });
  expect(choose).toHaveBeenCalledOnce();
});
