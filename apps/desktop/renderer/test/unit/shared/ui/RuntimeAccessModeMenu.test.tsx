// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeAccessModeMenu } from '../../../../src/shared/ui/RuntimeAccessModeMenu.js';

afterEach(cleanup);

it.each(['chat', 'settings'] as const)('requires explicit confirmation before enabling full access from %s', async (variant) => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<RuntimeAccessModeMenu mode="agent-approval" variant={variant} onChange={onChange} />);
  const trigger = screen.getByRole(variant === 'chat' ? 'button' : 'combobox');
  const openConfirmation = async () => {
    await user.click(trigger);
    await user.click(await screen.findByRole(variant === 'chat' ? 'menuitem' : 'option', { name: /^完全访问/ }));
    return within(await screen.findByRole('dialog', { name: '开启完全访问权限？' }));
  };

  const dialog = await openConfirmation();
  expect(onChange).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
  await user.keyboard('{Enter}');
  expect(onChange).not.toHaveBeenCalled();
  const cancel = dialog.getByRole('button', { name: '取消' });
  await user.tab();
  await waitFor(() => expect(document.activeElement).toBe(cancel));
  await user.tab();
  expect(document.activeElement).toBe(dialog.getByRole('button', { name: '开启完全访问权限' }));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(cancel);
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();

  const reopened = await openConfirmation();
  await user.click(reopened.getByRole('button', { name: '开启完全访问权限' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('full-access');
  expect(screen.queryByRole('dialog')).toBeNull();
});
