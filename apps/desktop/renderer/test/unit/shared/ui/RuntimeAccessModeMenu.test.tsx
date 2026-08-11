import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuntimeAccessModeMenu } from '../../../../src/shared/ui/RuntimeAccessModeMenu.js';

describe('RuntimeAccessModeMenu settings variant', () => {
  it('uses the shared settings select chrome while retaining the access-state content', () => {
    const html = renderToStaticMarkup(
      <RuntimeAccessModeMenu
        mode="full-access"
        variant="settings"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('class="sd-field sd-select-field');
    expect(html).toContain('runtime-access-mode-trigger--settings');
    expect(html).toContain('runtime-access-mode-trigger--full-access');
    expect(html).toContain('sd-select-field__chevron');
    expect(html).not.toContain('ant-btn');
  });
});
