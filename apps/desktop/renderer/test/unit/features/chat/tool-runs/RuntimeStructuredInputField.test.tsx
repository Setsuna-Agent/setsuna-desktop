import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeStructuredInputField } from '../../../../../src/features/chat/tool-runs/RuntimeStructuredInputField.js';

describe('RuntimeStructuredInputField', () => {
  it('uses the shared select field for single-choice input', () => {
    const html = renderToStaticMarkup(
      <RuntimeStructuredInputField
        field={{
          type: 'string',
          title: '选择处理方式',
          oneOf: [
            { const: 'retry', title: '重试' },
            { const: 'skip', title: '跳过' },
          ],
        }}
        name="resolution"
        required
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('class="sd-field sd-select-field');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('class="sd-select-field__form-control"');
    expect(html).toContain('请选择');
  });
});
