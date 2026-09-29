// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dropdown, PointMenu, type MenuProps } from '../src/menu.js';

afterEach(cleanup);

it.each(['context', 'point', 'click'] as const)('supports keyboard navigation, submenus and selection in the %s menu', async (kind) => {
  const select = vi.fn();
  const menu: MenuProps = { items: [
    { key: 'disabled', label: 'Unavailable', disabled: true },
    { key: 'copy', label: 'Copy' },
    { key: 'open', label: 'Open with', children: [{ key: 'editor', label: 'Editor', tooltip: 'Open in the editor' }] },
  ], onClick: select };
  function Harness() {
    const [open, setOpen] = useState(false);
    return kind !== 'point'
      ? <Dropdown trigger={[kind === 'context' ? 'contextMenu' : 'click']} menu={menu}><button>File</button></Dropdown>
      : <><button onClick={() => setOpen(true)}>File</button>{open ? <PointMenu x={40} y={60} menu={menu} onClose={() => setOpen(false)} /> : null}</>;
  }
  render(<Harness />);
  const user = userEvent.setup();
  const opener = screen.getByRole('button', { name: 'File' });
  opener.focus();
  if (kind === 'context') fireEvent.contextMenu(opener, { clientX: 40, clientY: 60 });
  else await user.click(opener);
  const content = await screen.findByRole('menu');
  fireEvent.keyDown(content, { key: 'Home' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy' })));
  await user.keyboard('{ArrowDown}{ArrowRight}');
  const editor = await screen.findByRole('menuitem', { name: 'Editor' });
  await waitFor(() => expect(document.activeElement).toBe(editor));
  await user.keyboard('{Enter}');
  expect(select).toHaveBeenCalledOnce();
  expect(select.mock.calls[0]?.[0].key).toBe('editor');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it('does not return focus to the dropdown trigger after pointer selection, including after keyboard navigation', async () => {
  const user = userEvent.setup({ skipHover: true });
  const select = vi.fn();
  render(<>
    <input aria-label="Message" />
    <Dropdown menu={{ items: [{ key: 'high', label: 'High' }], onClick: select }}>
      <button>Model</button>
    </Dropdown>
  </>);
  const trigger = screen.getByRole('button', { name: 'Model' });
  await user.click(screen.getByRole('textbox', { name: 'Message' }));
  await user.click(trigger);
  await user.click(await screen.findByRole('menuitem', { name: 'High' }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(select).toHaveBeenCalledOnce();
  expect(document.activeElement).not.toBe(trigger);

  trigger.focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('menuitem', { name: 'High' }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(select).toHaveBeenCalledTimes(2);
  expect(document.activeElement).not.toBe(trigger);
});
