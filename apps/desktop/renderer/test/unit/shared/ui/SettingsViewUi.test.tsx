// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ConfirmDialogTrigger } from '@setsuna-desktop/renderer-ui';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { settingsViewUi } from '../../../../src/shared/ui/SettingsViewUi.js';

afterEach(cleanup);

it('preserves the native button anchors and events through the settings UI used by confirmation dialogs', async () => {
  const { Button, IconButton } = settingsViewUi;
  const buttonRef = createRef<HTMLButtonElement>();
  const iconRef = createRef<HTMLButtonElement>();
  const onClick = vi.fn();
  const onConfirm = vi.fn();
  render(<>
    <Button ref={buttonRef} onClick={onClick}>Restore</Button>
    <ConfirmDialogTrigger title="Delete this record?" confirmLabel="Confirm deletion" cancelLabel="Cancel" onConfirm={onConfirm}>
      <IconButton ref={iconRef} label="Delete record" variant="danger"><span aria-hidden="true">×</span></IconButton>
    </ConfirmDialogTrigger>
  </>);

  // The host adapter must retain the actual DOM button for focus restoration.
  const restore = screen.getByRole('button', { name: 'Restore' });
  const remove = screen.getByRole('button', { name: 'Delete record' });
  expect(buttonRef.current).toBe(restore);
  expect(iconRef.current).toBe(remove);
  fireEvent.click(restore);
  expect(onClick).toHaveBeenCalledOnce();
  fireEvent.click(remove);
  const confirmation = await screen.findByRole('dialog');
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm deletion' }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
