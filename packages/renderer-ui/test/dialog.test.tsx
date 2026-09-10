// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { Button, Dialog, TextField } from '../src/index.js';

afterEach(cleanup);

it('restores focus to each opener after an autofocus field closes, including a dialog kept mounted', async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return <>
      <Button onClick={() => setOpen(true)}>First</Button>
      <Button onClick={() => setOpen(true)}>Second</Button>
      <Dialog title="Edit" open={open} onClose={() => setOpen(false)}><TextField autoFocus aria-label="Name" /></Dialog>
    </>;
  }
  render(<Harness />);
  for (const name of ['First', 'Second']) {
    const opener = screen.getByRole('button', { name });
    opener.focus();
    fireEvent.click(opener);
    const field = await screen.findByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  }
});
