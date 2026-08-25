// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../../../../src/shared/ui/primitives.js';

afterEach(cleanup);

describe('Checkbox', () => {
  it('owns accessible label, mixed state, and checked changes', async () => {
    const onChange = vi.fn();
    const view = render(
      <Checkbox checked={false} indeterminate onChange={onChange}>
        选择项目
      </Checkbox>,
    );
    const control = screen.getByRole('checkbox', { name: '选择项目' }) as HTMLInputElement;

    expect(control.indeterminate).toBe(true);
    await userEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);

    view.rerender(
      <Checkbox checked indeterminate={false} onChange={onChange}>
        选择项目
      </Checkbox>,
    );
    expect(control.checked).toBe(true);
    expect(control.indeterminate).toBe(false);
  });
});
