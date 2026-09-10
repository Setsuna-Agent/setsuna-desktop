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

it('shares the workspace menu theme across root and portaled submenus, including live theme changes', async () => {
  const styles = document.createElement('style');
  styles.dataset.contextMenuTest = '';
  styles.textContent = readFileSync('apps/desktop/renderer/src/shared/styles/context-menu.css', 'utf8');
  document.head.append(styles);
  const choose = vi.fn();
  render(<>
    <div className="desktop-file-context-menu" data-testid="file-menu"><button type="button">Existing file action</button></div>
    <ContextMenu trigger={['click']} menu={{ selectedKeys: ['origin/main'], items: [{
      key: 'branches', label: 'Branches', children: [{
        key: 'remotes', label: 'Remotes', children: [
          { key: 'origin/main', label: 'origin/main', onClick: choose },
          { key: 'archived', label: 'Archived', disabled: true, onClick: choose },
        ],
      }, {
        key: 'tags', label: 'Tags', disabled: true, children: [{ key: 'v1', label: 'v1' }],
      }],
    }] }}><button type="button">Git menu</button></ContextMenu>
  </>);
  fireEvent.click(screen.getByRole('button', { name: 'Git menu' }));
  const branches = await screen.findByRole('menuitem', { name: /^Branches/ });
  fireEvent.mouseEnter(branches);
  const remotes = await screen.findByRole('menuitem', { name: /^Remotes/ });
  fireEvent.mouseEnter(remotes);
  const branch = await screen.findByRole('menuitem', { name: 'origin/main' });
  const tags = screen.getByRole('menuitem', { name: /^Tags/ });
  const archived = screen.getByRole('menuitem', { name: 'Archived' });
  const menus = [branches, remotes, branch].map((item) => item.closest<HTMLElement>('[role="menu"]')!);
  expect(new Set(menus).size).toBe(3);
  menus.forEach((menu) => expect(menu.closest('.sd-context-dropdown')).not.toBeNull());

  const arrows = [branches, remotes, tags].map((item) => item.querySelector<HTMLElement>('.ant-dropdown-menu-submenu-arrow-icon')!);
  arrows.forEach((arrow) => expect(arrow).not.toBeNull());
  for (const [surface, text, muted] of [
    ['rgb(32, 32, 32)', 'rgb(220, 220, 220)', 'rgb(157, 157, 157)'],
    ['rgb(255, 255, 255)', 'rgb(32, 32, 32)', 'rgb(104, 104, 104)'],
  ]) {
    document.documentElement.style.setProperty('--app-surface', surface);
    document.documentElement.style.setProperty('--app-text', text);
    document.documentElement.style.setProperty('--app-text-muted', muted);
    for (const menu of [...menus, screen.getByTestId('file-menu')]) expect(getComputedStyle(menu).backgroundColor).toBe(surface);
    for (const item of [branches, remotes, branch, screen.getByRole('button', { name: 'Existing file action' })]) expect(getComputedStyle(item).color).toBe(text);
    for (const item of [tags, archived]) {
      expect(getComputedStyle(item).backgroundColor).toBe('transparent');
      expect(getComputedStyle(item).opacity).toBe('0.5');
    }
    for (const arrow of arrows) {
      expect(getComputedStyle(arrow).color).toBe(muted);
      expect(getComputedStyle(arrow).backgroundColor).toBe('transparent');
    }
  }
  fireEvent.click(archived);
  expect(choose).not.toHaveBeenCalled();
  fireEvent.click(branch);
  expect(choose).toHaveBeenCalledOnce();
});
