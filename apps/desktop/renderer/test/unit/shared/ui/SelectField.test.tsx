import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SelectField } from '../../../../src/shared/ui/SelectField.js';

describe('SelectField form behavior', () => {
  it('preserves native required validation for the custom listbox', () => {
    const html = renderToStaticMarkup(
      <SelectField aria-label="处理方式" name="resolution" required value="" onValueChange={() => undefined}>
        <option value="" disabled>未选择</option>
        <option value="retry">重试</option>
      </SelectField>,
    );

    expect(html).toContain('class="sd-field sd-select-field');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('class="sd-select-field__form-control"');
    expect(html).toContain('name="resolution"');
    expect(html).toContain('required=""');
  });

  it('allows domain content without replacing the shared trigger chrome', () => {
    const html = renderToStaticMarkup(
      <SelectField
        aria-label="权限策略"
        value="full-access"
        valueContent={<span className="permission-value">完全访问</span>}
        onValueChange={() => undefined}
      >
        <option value="full-access">完全访问</option>
      </SelectField>,
    );

    expect(html).toContain('class="sd-field sd-select-field');
    expect(html).toContain('class="permission-value"');
    expect(html).toContain('sd-select-field__chevron');
  });
});
