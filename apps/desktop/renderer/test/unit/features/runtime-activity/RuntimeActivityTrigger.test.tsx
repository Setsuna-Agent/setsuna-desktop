import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeActivityTrigger } from '../../../../src/features/runtime-activity/RuntimeActivityTrigger.js';

describe('RuntimeActivityTrigger', () => {
  it('uses a stable accessible label without deriving hidden activity counts', () => {
    const html = renderToStaticMarkup(
      <RuntimeActivityTrigger
        open={false}
        triggerRef={createRef<HTMLButtonElement>()}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="打开运行中心"');
    expect(html).toContain('aria-haspopup="dialog"');
  });
});
