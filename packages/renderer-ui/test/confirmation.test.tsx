// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Button, ConfirmationProvider, ConfirmDialogTrigger, Dialog, useConfirm } from '../src/index.js';

afterEach(cleanup);

it('cancels on Escape and owner removal, and never queues overlapping decisions', async () => {
  const user = userEvent.setup();
  const completed = vi.fn();
  function Requester() {
    const confirm = useConfirm();
    return <Button onClick={() => { void confirm({ title: 'Discard changes?', danger: true }).then(completed); }}>Discard</Button>;
  }
  const view = render(<ConfirmationProvider><Requester /></ConfirmationProvider>);
  const opener = screen.getByRole('button', { name: 'Discard' });
  await user.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
  await waitFor(() => expect(document.activeElement).toBe(dialog));
  expect(completed).not.toHaveBeenCalled();
  // Simulate another caller requesting a decision while the modal owns input.
  fireEvent.click(opener);
  await waitFor(() => expect(completed).toHaveBeenCalledExactlyOnceWith(false));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(completed).toHaveBeenCalledTimes(2));
  expect(completed.mock.calls).toEqual([[false], [false]]);
  await waitFor(() => expect(document.activeElement).toBe(opener));

  await user.click(opener);
  expect(await screen.findByRole('dialog')).toBeTruthy();
  view.rerender(<ConfirmationProvider><span>Another page</span></ConfirmationProvider>);
  await waitFor(() => expect(completed).toHaveBeenCalledTimes(3));
  expect(completed).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps a nested confirmation open while pending or failed, prevents duplicate execution, and restores its opener', async () => {
  const user = userEvent.setup();
  let fail!: (error: Error) => void;
  const onConfirm = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }))
    .mockResolvedValueOnce(undefined);
  render(<Dialog title="Project" onClose={() => undefined}>
    <ConfirmDialogTrigger title="Delete project?" confirmLabel="Delete" cancelLabel="Cancel" danger onConfirm={onConfirm}>
      <Button>Remove project</Button>
    </ConfirmDialogTrigger>
  </Dialog>);
  const opener = screen.getByRole('button', { name: 'Remove project' });
  await user.click(opener);
  const dialog = within(await screen.findByRole('dialog', { name: 'Delete project?' }));
  const submit = dialog.getByRole('button', { name: 'Delete' });
  await user.click(submit);
  fireEvent.click(submit);
  expect(onConfirm).toHaveBeenCalledOnce();
  expect((dialog.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'Delete project?' })).toBeTruthy();
  await act(async () => fail(new Error('Unable to delete')));
  expect(dialog.getByRole('alert').textContent).toBe('Unable to delete');
  await user.click(submit);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete project?' })).toBeNull());
  expect(onConfirm).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('dialog', { name: 'Project' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(opener));
});
