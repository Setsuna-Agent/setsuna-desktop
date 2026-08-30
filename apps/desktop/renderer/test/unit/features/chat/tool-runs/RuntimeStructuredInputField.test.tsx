// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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

  it('lets users toggle array choices directly without modifier keys', async () => {
    const user = userEvent.setup();
    render(<ArrayFieldHarness />);

    const performance = screen.getByRole('checkbox', { name: /性能对比方法/u }) as HTMLInputElement;
    const architecture = screen.getByRole('checkbox', { name: /分析现有项目/u }) as HTMLInputElement;

    await user.click(performance);
    await user.click(architecture);

    expect(performance.checked).toBe(true);
    expect(architecture.checked).toBe(true);

    await user.click(performance);
    expect(performance.checked).toBe(false);
    expect(architecture.checked).toBe(true);
  });
});

function ArrayFieldHarness() {
  const [value, setValue] = useState<import('@setsuna-desktop/contracts').RuntimeStructuredInputValue>([]);
  return (
    <RuntimeStructuredInputField
      field={{
        type: 'array',
        title: '下一步想优先讨论什么？',
        items: {
          anyOf: [
            { const: 'performance', title: '性能对比方法' },
            { const: 'architecture', title: '分析现有项目', description: '查看当前项目结构' },
          ],
        },
      }}
      name="topics"
      required={false}
      value={value}
      onChange={setValue}
    />
  );
}
