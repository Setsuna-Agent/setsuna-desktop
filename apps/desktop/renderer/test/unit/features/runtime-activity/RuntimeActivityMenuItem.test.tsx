import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeActivityMenuItem } from '../../../../src/features/runtime-activity/RuntimeActivityMenuItem.js';

describe('RuntimeActivityMenuItem', () => {
  it('exposes the runtime activity dialog through an accessible menu item', () => {
    const html = renderToStaticMarkup(
      <RuntimeActivityMenuItem onClick={vi.fn()} />,
    );

    expect(html).toContain('role="menuitem"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('>运行中心</button>');
  });
});
