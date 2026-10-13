// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { SettingsChoiceGroup } from '../../../../src/features/settings/components/SettingsControls.js';

afterEach(cleanup);

it('selects settings by arrow keys and leaves the group with one Tab', async () => {
  const user = userEvent.setup();
  function Choices() {
    const [value, setValue] = useState('light');
    return <><SettingsChoiceGroup ariaLabel="Appearance" value={value} onChange={setValue}
      options={['light', 'dark', 'system'].map((value) => ({ value, label: value, icon: null }))} /><button>Next setting</button></>;
  }
  render(<Choices />);
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'light', checked: true }));
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'dark', checked: true }));
  await user.keyboard('{End}{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'light', checked: true }));
  await user.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'system', checked: true }));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next setting' }));
});
