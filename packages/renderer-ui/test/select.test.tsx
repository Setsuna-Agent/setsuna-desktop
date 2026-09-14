// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SelectField } from '../src/select.js';

afterEach(cleanup);

it('blocks required form submission until a choice is selected and submits its domain value', async () => {
  const submit = vi.fn();
  function Form() {
    const [value, setValue] = useState('');
    return <form onSubmit={(event) => {
      event.preventDefault();
      submit(new FormData(event.currentTarget).get('resolution'));
    }}>
      <SelectField aria-label="Resolution" name="resolution" required value={value} onValueChange={setValue}>
        <option value="" disabled>Choose a resolution</option>
        <option value="retry">Retry</option>
      </SelectField>
      <button type="submit">Continue</button>
    </form>;
  }

  const user = userEvent.setup();
  render(<Form />);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText('Resolution'));
  await user.click(await screen.findByRole('option', { name: 'Retry' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(submit).toHaveBeenCalledExactlyOnceWith('retry');
});
