// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider, Popconfirm } from 'antd';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { settingsViewUi } from '../../../../src/shared/ui/SettingsViewUi.js';

afterEach(cleanup);

it('preserves the native button anchors and events through the settings UI used by confirmation popovers', async () => {
  const { Button, IconButton } = settingsViewUi;
  const buttonRef = createRef<HTMLButtonElement>();
  const iconRef = createRef<HTMLButtonElement>();
  const onClick = vi.fn();
  const onConfirm = vi.fn();
  render(<ConfigProvider theme={{ token: { motion: false } }}>
    <Button ref={buttonRef} onClick={onClick}>Restore</Button>
    <Popconfirm title="Delete this record?" okText="Confirm deletion" onConfirm={onConfirm}>
      <IconButton ref={iconRef} label="Delete record" variant="danger"><span aria-hidden="true">×</span></IconButton>
    </Popconfirm>
  </ConfigProvider>);

  // The host adapter must expose the actual DOM anchor to the popover's ref.
  // A plain function wrapper can still forward clicks while breaking placement.
  const restore = screen.getByRole('button', { name: 'Restore' });
  const remove = screen.getByRole('button', { name: 'Delete record' });
  expect(buttonRef.current).toBe(restore);
  expect(iconRef.current).toBe(remove);
  fireEvent.click(restore);
  expect(onClick).toHaveBeenCalledOnce();
  fireEvent.click(remove);
  const confirmation = await screen.findByRole('tooltip');
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm deletion' }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
