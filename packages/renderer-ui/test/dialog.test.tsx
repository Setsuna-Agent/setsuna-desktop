// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { Button, Dialog, SelectField, TextField } from '../src/index.js';

afterEach(async () => {
  cleanup();
  // Radix defers removal of unmounted focus scopes to the next task.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
});

function ModelSettings() {
  const [open, setOpen] = useState(true);
  const [model, setModel] = useState('');
  return <Dialog title="Git settings" open={open} onClose={() => setOpen(false)}>
    <SelectField aria-label="Model" value={model} onValueChange={setModel}>
      <option value="">Follow conversation</option>
      <option value="unavailable" disabled>Unavailable model</option>
      {Array.from({ length: 20 }, (_, index) => <option key={index} value={`model-${index}`}>Model {index}</option>)}
    </SelectField>
  </Dialog>;
}

it('allows pointer selection and keyboard dismissal of a select inside a modal', async () => {
  const user = userEvent.setup();
  render(<ModelSettings />);
  const trigger = screen.getByLabelText('Model');
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: 'Model 19' }));
  await waitFor(() => expect(trigger.textContent).toBe('Model 19'));
  await waitFor(() => expect(document.activeElement).toBe(trigger));

  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model 19' })));
  await user.keyboard('{Home}{ArrowDown}');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Model 0' })));
  await user.keyboard('{Enter}');
  await waitFor(() => expect(trigger.textContent).toBe('Model 0'));
  await waitFor(() => expect(document.activeElement).toBe(trigger));

  await user.click(trigger);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(screen.getByRole('dialog')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(trigger));

  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: 'Follow conversation' }));
  await waitFor(() => expect(trigger.textContent).toBe('Follow conversation'));
});

it('allows wheel scrolling in a modal select while keeping background scrolling locked', async () => {
  render(<ModelSettings />);
  fireEvent.click(screen.getByLabelText('Model'));
  const menu = await screen.findByRole('listbox');
  const viewport = menu.querySelector<HTMLElement>('.sd-select-menu__viewport')!;
  // happy-dom has no layout; provide a long list with room to scroll in both directions.
  viewport.style.overflowY = 'auto';
  Object.defineProperties(viewport, {
    clientHeight: { value: 200 },
    scrollHeight: { value: 800 },
    scrollTop: { value: 100, writable: true },
  });
  const option = screen.getByRole('option', { name: 'Model 0' });
  expect(fireEvent.wheel(option, { deltaY: 40 })).toBe(true);
  expect(fireEvent.wheel(option, { deltaY: -40 })).toBe(true);
  expect(fireEvent.wheel(document.body, { deltaY: 40 })).toBe(false);
});

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
