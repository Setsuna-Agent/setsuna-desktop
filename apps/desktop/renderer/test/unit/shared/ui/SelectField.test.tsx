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
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('name="resolution"');
    expect(html).toContain('required=""');
  });
});
