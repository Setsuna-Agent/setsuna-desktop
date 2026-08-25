// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compactStructuredInputValues,
  RuntimeStructuredInputField,
  structuredInputDefaults,
} from '../../../../../src/features/chat/tool-runs/RuntimeStructuredInputField.js';

afterEach(cleanup);

describe('RuntimeStructuredInputField', () => {
  it('keeps false valid for a required JSON Schema boolean', () => {
    render(
      <form>
        <RuntimeStructuredInputField
          field={{ type: 'boolean', title: '确认' }}
          name="confirm"
          required
          value={false}
          onChange={vi.fn()}
        />
      </form>,
    );

    const control = screen.getByRole('checkbox', { name: /确认/u }) as HTMLInputElement;
    expect(control.required).toBe(false);
    expect(control.checkValidity()).toBe(true);
    expect(structuredInputDefaults({ confirm: { type: 'boolean' } })).toEqual({ confirm: false });
    expect(compactStructuredInputValues({ confirm: false })).toEqual({ confirm: false });
  });
});
